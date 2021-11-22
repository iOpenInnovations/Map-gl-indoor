import IndoorMap from './IndoorMap';
import IndoorControl from './IndoorControl';
import LngLatBounds from './LngLatBounds';
import { overlap, filterWithLevel, distance } from './Utils';

type SavedFilter = {
    layerId: string,
    filter: FilterSpecification
}

import type { Level, FilterSpecification, LayerSpecification, MapGLMap } from './types';

const SOURCE_ID = 'indoor';

class MapGLIndoor {

    _map: MapGLMap;
    _level: Level | null;

    _indoorMaps: Array<IndoorMap>;
    _selectedMap: IndoorMap | null;
    _previousSelectedMap: IndoorMap | null;
    _previousSelectedLevel: Level | null;

    _savedFilters: Array<SavedFilter>;
    _mapLoaded: boolean;

    _control: IndoorControl;

    _updateMapPromise: Promise<void>;

    constructor(map: MapGLMap) {
        this._map = map;
        this._level = null;

        this._indoorMaps = [];
        this._savedFilters = [];
        this._selectedMap = null;
        this._previousSelectedMap = null;
        this._previousSelectedLevel = null;
        this._mapLoaded = false;
        this._updateMapPromise = Promise.resolve();

        this._control = new IndoorControl(this);

        if (this._map.loaded()) {
            this._mapLoaded = true;
        } else {
            this._map.on('load', () => {
                this._mapLoaded = true;
                this._updateSelectedMapIfNeeded();
            });
        }

        this._map.on('moveend', () => this._updateSelectedMapIfNeeded());
    }

    getSelectedMap(): IndoorMap | null {
        return this._selectedMap;
    }

    getLevel(): Level | null {
        return this._level;
    }

    setLevel(level: Level | null, fireEvent: Boolean = true): void {

        if (this._selectedMap === null) {
            throw new Error('Cannot set level, no map has been selected');
        }

        this._level = level;
        this._updateFiltering();
        if (fireEvent) {
            this._map.fire('indoor.level.changed', { level });
        }
    }

    get control(): IndoorControl {
        return this._control;
    }

    /**
     * ***********************
     * Handle level change
     * ***********************
     */

    _addLayerForFiltering(layer: LayerSpecification, beforeLayerId?: string) {
        this._map.addLayer(layer, beforeLayerId);
        this._savedFilters.push({
            layerId: layer.id,
            filter: this._map.getFilter(layer.id) || ["all"]
        });
    }

    _removeLayerForFiltering(layerId: string) {
        this._savedFilters = this._savedFilters.filter(({ layerId: id }) => layerId !== id);
        this._map.removeLayer(layerId);
    }

    _updateFiltering() {
        const level = this._level;

        let filterFn: (filter: FilterSpecification) => FilterSpecification;
        if (level !== null) {
            const showFeaturesWithEmptyLevel = this._selectedMap ? this._selectedMap.showFeaturesWithEmptyLevel : false;
            filterFn = (filter: FilterSpecification) => filterWithLevel(filter, level, showFeaturesWithEmptyLevel);
        } else {
            filterFn = (filter: FilterSpecification): FilterSpecification => filter;
        }

        this._savedFilters.forEach(({ layerId, filter }) => this._map.setFilter(layerId, filterFn(filter)));
    }



    /**
     * **************
     * Handle maps
     * **************
     */

    addMap(map: IndoorMap) {
        this._indoorMaps.push(map);
        this._updateSelectedMapIfNeeded();
    }

    removeMap(map: IndoorMap) {
        this._indoorMaps = this._indoorMaps.filter(_indoorMap => _indoorMap !== map);
        this._updateSelectedMapIfNeeded();
    }


    async _updateSelectedMapIfNeeded() {

        if (!this._mapLoaded) {
            return;
        }

        // Avoid to call "closestMap" or "updateSelectedMap" if the previous call is not finished yet
        await this._updateMapPromise;
        this._updateMapPromise = (async () => {
            const closestMap = this._closestMap();
            if (closestMap !== this._selectedMap) {
                this._updateSelectedMap(closestMap);
            }
        })();
    }

    _updateSelectedMap(indoorMap: IndoorMap | null) {

        const previousMap = this._selectedMap;

        // Remove the previous selected map if it exists
        if (previousMap !== null) {
            previousMap.layersToHide.forEach(layerId => this._map.setLayoutProperty(layerId, 'visibility', 'visible'));
            previousMap.layers.forEach(({ id }) => this._removeLayerForFiltering(id));
            this._map.removeSource(SOURCE_ID);

            if (!indoorMap) {
                // Save the previous map level.
                // It enables the user to exit and re-enter, keeping the same level shown.
                this._previousSelectedLevel = this._level;
                this._previousSelectedMap = previousMap;
            }

            this.setLevel(null, false);
            this._map.fire('indoor.map.unloaded', { indoorMap: previousMap });
        }

        this._selectedMap = indoorMap;
        if (!indoorMap) {
            return;
        }

        const { geojson, layers, levelsRange, beforeLayerId } = indoorMap;

        // Add map source
        this._map.addSource(SOURCE_ID, {
            type: "geojson",
            data: geojson
        });

        // Add layers and save filters
        layers.forEach(layer => this._addLayerForFiltering(layer, beforeLayerId));

        // Hide layers which can overlap for rendering
        indoorMap.layersToHide.forEach(layerId => this._map.setLayoutProperty(layerId, 'visibility', 'none'));

        // Restore the same level when the previous selected map is the same.
        const level = this._previousSelectedMap === indoorMap
            ? this._previousSelectedLevel
            : Math.max(Math.min(indoorMap.defaultLevel, levelsRange.max), levelsRange.min)

        this.setLevel(level, false);

        this._map.fire('indoor.map.loaded', { indoorMap });
    }

    _closestMap() {

        // TODO enhance this condition
        if (this._map.getZoom() < 17) {
            return null;
        }

        const cameraBounds = LngLatBounds.fromMapGL(this._map.getBounds());
        const mapsInBounds = this._indoorMaps.filter(indoorMap =>
            overlap(indoorMap.bounds, cameraBounds)
        );

        if (mapsInBounds.length === 0) {
            return null;
        }

        if (mapsInBounds.length === 1) {
            return mapsInBounds[0];
        }

        /*
         * If there is multiple maps at this step, select the closest
         */
        let minDist = Number.POSITIVE_INFINITY;
        let closestMap = mapsInBounds[0];
        for (const map of mapsInBounds) {
            const _dist = distance(map.bounds.getCenter(), cameraBounds.getCenter());
            if (_dist < minDist) {
                closestMap = map;
                minDist = _dist;
            }
        }
        return closestMap;
    }

}

export default MapGLIndoor;

