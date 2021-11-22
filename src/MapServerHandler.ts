import IndoorMap from './IndoorMap';
import LngLat from './LngLat';
import LngLatBounds from './LngLatBounds';
import { destinationPoint, distance } from './Utils';

import type { IndoorMapOptions, MapGLMap } from './types';

type RemoteMap = {
    name: string,
    path: string,
    indoorMap?: IndoorMap
}

const MIN_ZOOM_TO_DOWNLOAD = 17;
const AREA_TO_DOWNLOAD = 1000; // in terms of distance from user

class MapServerHandler {

    serverUrl: string;

    map: MapGLMap;
    remoteMapsDownloaded: RemoteMap[];
    downloadedBounds: LngLatBounds | null;

    loadMapsPromise: Promise<void> = Promise.resolve();

    indoorMapOptions?: IndoorMapOptions;

    private constructor(serverUrl: string, map: MapGLMap, indoorMapOptions?: IndoorMapOptions) {
        this.serverUrl = serverUrl;
        this.map = map;
        this.indoorMapOptions = indoorMapOptions;
        this.remoteMapsDownloaded = [];
        this.downloadedBounds = null;

        if (map.loaded()) {
            this.loadMapsIfNecessary();
        } else {
            map.on('load', () => this.loadMapsIfNecessary())
        }
        map.on('move', () => this.loadMapsIfNecessary());
    }

    private loadMapsIfNecessary = async () => {

        if (this.map.getZoom() < MIN_ZOOM_TO_DOWNLOAD) {
            return;
        }

        const viewPort = this.map.getBounds();
        if (this.downloadedBounds !== null) {
            if (this.downloadedBounds.contains(viewPort.getNorthEast()) &&
                this.downloadedBounds.contains(viewPort.getSouthWest())) {
                // Maps of the viewport have already been downloaded.
                return;
            }
        }

        const distanceEastWest = distance(
            LngLat.convert(viewPort.getNorthEast()),
            LngLat.convert(viewPort.getNorthWest())
        );
        const distanceNorthSouth = distance(
            LngLat.convert(viewPort.getNorthEast()),
            LngLat.convert(viewPort.getSouthEast())
        );
        // It is not necessary to compute others as we are at zoom >= 17, the approximation is enough.
        const maxDistanceOnScreen = Math.max(distanceEastWest, distanceNorthSouth);
        const bestSizeOfAreaToDownload = Math.max(AREA_TO_DOWNLOAD, maxDistanceOnScreen * 2);

        const center = LngLat.convert(this.map.getCenter());
        const dist = bestSizeOfAreaToDownload * Math.sqrt(2);
        const northEast = destinationPoint(center, dist, Math.PI / 4);
        const southWest = destinationPoint(center, dist, - 3 * Math.PI / 4);
        const boundsToDownload = new LngLatBounds(southWest, northEast);

        // TODO: I put this here because fetch is async and takes more time than the next call to loadMapsIfNecessary.
        this.downloadedBounds = boundsToDownload;

        await this.loadMapsPromise;
        this.loadMapsPromise = this.loadMapsInBounds(boundsToDownload);
    }

    private loadMapsInBounds = async (bounds: LngLatBounds) => {
        const url = this.serverUrl + `/maps-in-bounds/${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
        const maps = await (await fetch(url)).json();

        const mapsToRemove = this.remoteMapsDownloaded.reduce((acc: RemoteMap[], map: RemoteMap) => {
            if (!maps.find((_map: RemoteMap) => _map.path === map.path)) {
                acc.push(map);
            }
            return acc;
        }, []);

        const mapsToAdd = maps.reduce((acc: RemoteMap[], map: RemoteMap) => {
            if (!this.remoteMapsDownloaded.find(_map => _map.path === map.path)) {
                acc.push(map);
            }
            return acc;
        }, []);

        mapsToAdd.forEach(this.addCustomMap);
        mapsToRemove.forEach(this.removeCustomMap);
    };

    private addCustomMap = async (map: RemoteMap) => {
        const geojson = await (await fetch(this.serverUrl + map.path)).json();
        map.indoorMap = IndoorMap.fromGeojson(geojson, this.indoorMapOptions);
        this.map.indoor?.addMap(map.indoorMap);
        this.remoteMapsDownloaded.push(map);
    };

    private removeCustomMap = async (map: RemoteMap) => {
        if (!map.indoorMap) {
            return;
        }
        this.map.indoor?.removeMap(map.indoorMap);
        this.remoteMapsDownloaded.splice(this.remoteMapsDownloaded.indexOf(map), 1);
    }


    static manage(server: string, map: MapGLMap, indoorMapOptions?: IndoorMapOptions) {
        return new MapServerHandler(server, map, indoorMapOptions);
    }

}

export default MapServerHandler;
