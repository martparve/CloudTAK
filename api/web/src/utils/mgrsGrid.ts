/**
 * MGRS / UTM grid overlay generator.
 *
 * Produces GeoJSON grid lines and labels for the visible map area. The grid
 * interval follows the zoom level: 100 km squares when zoomed out, 10 km and
 * 1 km squares when zoomed in. Lines are generated per UTM zone and clipped to
 * the zone's longitude band, so the grid stays correct across zone boundaries.
 */
import {
    latLngToUTM,
    utmToLatLng,
    latLonToZoneNumber,
    latitudeToZoneLetter,
    mgrsSquareId,
} from './coordinateFormat.ts';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

export type GridBounds = [west: number, south: number, east: number, north: number];

export type GridInterval = 100000 | 10000 | 1000;

export type GridFeature = Feature<LineString, GridLineProperties> | Feature<Point, GridLabelProperties>;

export interface GridLineProperties {
    kind: 'line';
    /** 'major' = 100 km square edge, 'minor' = 10 km / 1 km line */
    weight: 'major' | 'minor';
}

export interface GridLabelProperties {
    kind: 'label';
    /** 'square' = 100 km square id such as "35V MF"; 'value' = km value along an edge */
    role: 'square' | 'value';
    text: string;
}

/** Grid spacing in metres for a given zoom level. */
export function gridIntervalForZoom(zoom: number): GridInterval {
    if (zoom < 9) return 100000;
    if (zoom < 13) return 10000;
    return 1000;
}

/** Latitude limits of the UTM system. */
const UTM_LAT_MIN = -80;
const UTM_LAT_MAX = 84;

/** Hard cap so a pathological view (e.g. whole world at zoom 8.9) cannot lock the UI. */
const MAX_LINES_PER_ZONE = 400;

/** Longitude band [west, east] of a UTM zone number (ignoring the Norway/Svalbard exceptions). */
export function zoneLongitudeBand(zoneNum: number): [number, number] {
    return [(zoneNum - 1) * 6 - 180, zoneNum * 6 - 180];
}

/**
 * Build grid lines and labels for the given bounds and zoom.
 * Returns an empty collection when the view is outside the UTM latitude range
 * or spans too many zones to be useful.
 */
export function buildMgrsGrid(bounds: GridBounds, zoom: number): FeatureCollection<LineString | Point, GridLineProperties | GridLabelProperties> {
    const features: GridFeature[] = [];
    const interval = gridIntervalForZoom(zoom);

    const west = Math.max(bounds[0], -180);
    const east = Math.min(bounds[2], 180);
    const south = Math.max(bounds[1], UTM_LAT_MIN);
    const north = Math.min(bounds[3], UTM_LAT_MAX);

    if (south >= north || west >= east) return { type: 'FeatureCollection', features };

    const midLat = (south + north) / 2;
    const zoneLetter = latitudeToZoneLetter(midLat);
    if (!zoneLetter) return { type: 'FeatureCollection', features };

    const firstZone = latLonToZoneNumber(midLat, west);
    const lastZone = latLonToZoneNumber(midLat, Math.min(east, 179.999));

    // More than 4 zones on screen means we are zoomed far out: skip, the
    // grid would be unreadable noise.
    if (lastZone - firstZone > 3) return { type: 'FeatureCollection', features };

    for (let zoneNum = firstZone; zoneNum <= lastZone; zoneNum++) {
        features.push(...gridForZone(zoneNum, zoneLetter, [west, south, east, north], interval));
    }

    return { type: 'FeatureCollection', features };
}

function gridForZone(zoneNum: number, zoneLetter: string, bounds: GridBounds, interval: GridInterval): GridFeature[] {
    const features: GridFeature[] = [];
    const [bandWest, bandEast] = zoneLongitudeBand(zoneNum);

    // Portion of the view that falls inside this zone's longitude band.
    const west = Math.max(bounds[0], bandWest);
    const east = Math.min(bounds[2], bandEast);
    const south = bounds[1];
    const north = bounds[3];
    if (west >= east) return features;

    // UTM extent of the visible part of the zone: take all four corners plus the
    // mid-edges because meridian convergence bends the box.
    const samples = [
        latLngToUTM(south, west), latLngToUTM(south, east),
        latLngToUTM(north, west), latLngToUTM(north, east),
        latLngToUTM((south + north) / 2, west), latLngToUTM((south + north) / 2, east),
        latLngToUTM(south, (west + east) / 2), latLngToUTM(north, (west + east) / 2),
    ].map((utm) => forceZone(utm, zoneNum, zoneLetter));

    const viewMinE = Math.min(...samples.map((s) => s.easting));
    const viewMaxE = Math.max(...samples.map((s) => s.easting));
    const viewMinN = Math.min(...samples.map((s) => s.northing));
    const viewMaxN = Math.max(...samples.map((s) => s.northing));

    const minE = Math.floor(viewMinE / interval) * interval;
    const maxE = Math.ceil(viewMaxE / interval) * interval;
    const minN = Math.floor(viewMinN / interval) * interval;
    const maxN = Math.ceil(viewMaxN / interval) * interval;

    const eastingCount = (maxE - minE) / interval;
    const northingCount = (maxN - minN) / interval;
    if (eastingCount > MAX_LINES_PER_ZONE || northingCount > MAX_LINES_PER_ZONE) return features;

    // Sample step along each line: fine enough that lines stay straight on screen.
    const step = interval / 4;

    const inBand = (lng: number) => lng >= bandWest - 1e-9 && lng <= bandEast + 1e-9;
    const inView = (lat: number, lng: number) => lat >= south && lat <= north && lng >= bounds[0] && lng <= bounds[2];

    // Lines of constant easting (run north-south)
    for (let e = minE; e <= maxE; e += interval) {
        const coords: Array<[number, number]> = [];
        for (let n = minN; n <= maxN; n += step) {
            const [lat, lng] = utmToLatLng(zoneNum, zoneLetter, e, n);
            if (!inBand(lng) || lat < UTM_LAT_MIN || lat > UTM_LAT_MAX) {
                if (coords.length >= 2) features.push(lineFeature(coords, e, interval));
                coords.length = 0;
                continue;
            }
            coords.push([lng, lat]);
        }
        if (coords.length >= 2) features.push(lineFeature(coords, e, interval));
    }

    // Lines of constant northing (run east-west)
    for (let n = minN; n <= maxN; n += interval) {
        const coords: Array<[number, number]> = [];
        for (let e = minE; e <= maxE; e += step) {
            const [lat, lng] = utmToLatLng(zoneNum, zoneLetter, e, n);
            if (!inBand(lng) || lat < UTM_LAT_MIN || lat > UTM_LAT_MAX) {
                if (coords.length >= 2) features.push(lineFeature(coords, n, interval));
                coords.length = 0;
                continue;
            }
            coords.push([lng, lat]);
        }
        if (coords.length >= 2) features.push(lineFeature(coords, n, interval));
    }

    // Labels: one 100 km square id per square, placed at the centre of the
    // square's visible portion so it stays on screen when zoomed in; km values
    // at cell centres when zoomed in.
    const squareStart = (v: number) => Math.floor(v / 100000) * 100000;
    for (let e = squareStart(viewMinE); e <= viewMaxE; e += 100000) {
        for (let n = squareStart(viewMinN); n <= viewMaxN; n += 100000) {
            const cE = (Math.max(e, viewMinE) + Math.min(e + 100000, viewMaxE)) / 2;
            const cN = (Math.max(n, viewMinN) + Math.min(n + 100000, viewMaxN)) / 2;
            const [lat, lng] = utmToLatLng(zoneNum, zoneLetter, cE, cN);
            if (!inBand(lng) || !inView(lat, lng)) continue;
            features.push(labelFeature([lng, lat], 'square', `${zoneNum}${zoneLetter} ${mgrsSquareId(zoneNum, cE, cN)}`));
        }
    }

    if (interval < 100000) {
        const digits = interval === 10000 ? 1 : 2;
        for (let e = minE; e < maxE; e += interval) {
            for (let n = minN; n < maxN; n += interval) {
                const [lat, lng] = utmToLatLng(zoneNum, zoneLetter, e + interval / 2, n + interval / 2);
                if (!inBand(lng) || !inView(lat, lng)) continue;
                const eLabel = String(Math.floor((e % 100000) / interval)).padStart(digits, '0');
                const nLabel = String(Math.floor((n % 100000) / interval)).padStart(digits, '0');
                features.push(labelFeature([lng, lat], 'value', `${eLabel} ${nLabel}`));
            }
        }
    }

    return features;
}

/**
 * latLngToUTM picks the zone for the point; when a point lies just outside the
 * zone we are drawing, recompute its easting/northing in *our* zone so the
 * grid extent covers the full visible band.
 */
function forceZone(utm: ReturnType<typeof latLngToUTM>, zoneNum: number, zoneLetter: string): { easting: number; northing: number } {
    if (utm.zoneNum === zoneNum) return utm;
    const [lat, lng] = utmToLatLng(utm.zoneNum, utm.zoneLetter, utm.easting, utm.northing);
    return latLngToUTMInZone(lat, lng, zoneNum, zoneLetter);
}

/** Transverse Mercator forward projection into a specific zone (no zone auto-selection). */
export function latLngToUTMInZone(latitude: number, longitude: number, zoneNum: number, zoneLetter: string): { easting: number; northing: number } {
    const K0 = 0.9996;
    const E = 0.00669438;
    const E_P2 = E / (1 - E);
    const E2 = E * E;
    const E3 = E2 * E;
    const R = 6378137;
    const M1 = 1 - E / 4 - 3 * E2 / 64 - 5 * E3 / 256;
    const M2 = 3 * E / 8 + 3 * E2 / 32 + 45 * E3 / 1024;
    const M3 = 15 * E2 / 256 + 45 * E3 / 1024;
    const M4 = 35 * E3 / 3072;

    const latRad = latitude * Math.PI / 180;
    const latSin = Math.sin(latRad);
    const latCos = Math.cos(latRad);
    const latTan = Math.tan(latRad);
    const latTan2 = latTan * latTan;
    const latTan4 = latTan2 * latTan2;

    const centralLng = (zoneNum - 1) * 6 - 180 + 3;
    const lonRad = longitude * Math.PI / 180;
    const centralLonRad = centralLng * Math.PI / 180;

    const n = R / Math.sqrt(1 - E * latSin * latSin);
    const c = E_P2 * latCos * latCos;
    const a = latCos * (lonRad - centralLonRad);
    const a2 = a * a, a3 = a2 * a, a4 = a3 * a, a5 = a4 * a, a6 = a5 * a;

    const m = R * (M1 * latRad - M2 * Math.sin(2 * latRad) + M3 * Math.sin(4 * latRad) - M4 * Math.sin(6 * latRad));

    const easting = K0 * n * (a + a3 / 6 * (1 - latTan2 + c) + a5 / 120 * (5 - 18 * latTan2 + latTan4 + 72 * c - 58 * E_P2)) + 500000;
    let northing = K0 * (m + n * latTan * (a2 / 2 + a4 / 24 * (5 - latTan2 + 9 * c + 4 * c * c) + a6 / 720 * (61 - 58 * latTan2 + latTan4 + 600 * c - 330 * E_P2)));
    if (zoneLetter < 'N') northing += 10000000;

    return { easting, northing };
}

function lineFeature(coords: Array<[number, number]>, value: number, interval: GridInterval): Feature<LineString, GridLineProperties> {
    return {
        type: 'Feature',
        properties: {
            kind: 'line',
            weight: (value % 100000 === 0 || interval === 100000) ? 'major' : 'minor',
        },
        geometry: { type: 'LineString', coordinates: coords.slice() },
    };
}

function labelFeature(coord: [number, number], role: GridLabelProperties['role'], text: string): Feature<Point, GridLabelProperties> {
    return {
        type: 'Feature',
        properties: { kind: 'label', role, text },
        geometry: { type: 'Point', coordinates: coord },
    };
}
