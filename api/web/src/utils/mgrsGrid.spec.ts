import { describe, expect, it } from 'vitest';
import { buildMgrsGrid, gridIntervalForZoom, labelDigits, labelText, zoneLongitudeBand, latLngToUTMInZone } from './mgrsGrid.ts';
import { latLngToUTM } from './coordinateFormat.ts';

type Props = { kind: string; role?: string; text?: string };

describe('mgrsGrid', () => {
    // Rummu, Estonia: UTM zone 35V
    const estonia: [number, number, number, number] = [24.1, 59.1, 24.9, 59.5];

    it('picks the finest interval that keeps lines readable on screen', () => {
        const lat = 59.3;
        expect(gridIntervalForZoom(6, lat)).toBe(100000);
        expect(gridIntervalForZoom(10, lat)).toBe(10000);
        // A "1 km" scale bar view in Estonia: 1 km lines are ~70 px apart
        expect(gridIntervalForZoom(12.5, lat)).toBe(1000);
        expect(gridIntervalForZoom(14, lat)).toBe(1000);
        expect(gridIntervalForZoom(15.5, lat)).toBe(100);
        expect(gridIntervalForZoom(19, lat)).toBe(100);
        // At the equator the same zoom covers more ground, so 100 m lines arrive later
        expect(gridIntervalForZoom(15.5, 0)).toBe(1000);
        expect(gridIntervalForZoom(16.5, 0)).toBe(100);
    });

    it('labels lines with the leading digits of the MGRS value', () => {
        expect(labelDigits(100000)).toBe(0);
        expect(labelDigits(10000)).toBe(2);
        expect(labelDigits(1000)).toBe(2);
        expect(labelDigits(100)).toBe(3);
        // Easting 583 227 in square LF reads "83227" on the readout
        expect(labelText(580000, 10000)).toBe('80');
        expect(labelText(583000, 1000)).toBe('83');
        expect(labelText(583200, 100)).toBe('832');
        expect(labelText(6500000, 1000)).toBe('00');
    });

    it('computes zone longitude bands', () => {
        expect(zoneLongitudeBand(35)).toEqual([24, 30]);
        expect(zoneLongitudeBand(1)).toEqual([-180, -174]);
    });

    it('matches the zone-selecting projection when the zone is the natural one', () => {
        const natural = latLngToUTM(59.3, 25.0);
        const forced = latLngToUTMInZone(59.3, 25.0, natural.zoneNum, natural.zoneLetter);
        expect(forced.easting).toBeCloseTo(natural.easting, 3);
        expect(forced.northing).toBeCloseTo(natural.northing, 3);
    });

    it('builds 10 km lines with edge labels for a regional view', () => {
        const grid = buildMgrsGrid(estonia, 11);
        const props = grid.features.map((f) => f.properties as Props);
        const lines = props.filter((p) => p.kind === 'line');
        const squares = props.filter((p) => p.role === 'square');
        const eastings = props.filter((p) => p.role === 'easting');
        const northings = props.filter((p) => p.role === 'northing');

        expect(lines.length).toBeGreaterThan(10);
        expect(eastings.length).toBeGreaterThan(2);
        expect(northings.length).toBeGreaterThan(2);
        expect(eastings.every((p) => /^\d{2}$/.test(p.text || ''))).toBe(true);
        expect(squares.some((p) => (p.text || '').startsWith('35V '))).toBe(true);

        // Every line vertex should be inside zone 35's longitude band.
        for (const f of grid.features) {
            if (f.geometry.type !== 'LineString') continue;
            for (const [lng] of f.geometry.coordinates) {
                expect(lng).toBeGreaterThanOrEqual(24 - 1e-6);
                expect(lng).toBeLessThanOrEqual(30 + 1e-6);
            }
        }
    });

    it('places easting labels on the top edge and northing labels on the left edge', () => {
        const [w, s, e, n] = estonia;
        const grid = buildMgrsGrid(estonia, 11);
        const eastingLats: number[] = [];
        const northingLngs: number[] = [];
        for (const f of grid.features) {
            const p = f.properties as Props;
            if (f.geometry.type !== 'Point') continue;
            const [lng, lat] = f.geometry.coordinates;
            if (p.role === 'easting') eastingLats.push(lat);
            if (p.role === 'northing') northingLngs.push(lng);
        }
        // Every label sits inside the view; the ones whose line reaches the edge
        // sit exactly at the inset (3.5 % from the top, 4.5 % from the left).
        expect(eastingLats.every((lat) => lat > s && lat < n)).toBe(true);
        expect(northingLngs.every((lng) => lng > w && lng < e)).toBe(true);
        expect(eastingLats.filter((lat) => Math.abs(lat - (n - (n - s) * 0.035)) < 1e-6).length).toBeGreaterThan(2);
        expect(northingLngs.filter((lng) => Math.abs(lng - (w + (e - w) * 0.045)) < 1e-6).length).toBeGreaterThan(2);
    });

    it('produces a 100 m grid with three-digit labels when zoomed in', () => {
        const grid = buildMgrsGrid([24.70, 59.36, 24.72, 59.37], 17);
        const props = grid.features.map((f) => f.properties as Props);
        const lines = props.filter((p) => p.kind === 'line');
        const labels = props.filter((p) => p.role === 'easting' || p.role === 'northing');
        expect(lines.length).toBeGreaterThan(15);
        expect(labels.length).toBeGreaterThan(5);
        expect(labels.every((p) => /^\d{3}$/.test(p.text || ''))).toBe(true);
    });

    it('puts the square id in the top-left corner of the view when one square fills it', () => {
        const [w, s, e, n] = estonia;
        const grid = buildMgrsGrid(estonia, 13);
        const squares = grid.features.filter((f) => (f.properties as Props).role === 'square');
        expect(squares).toHaveLength(1);
        const [lng, lat] = (squares[0].geometry as GeoJSON.Point).coordinates;
        expect(lng).toBeCloseTo(w + (e - w) * 0.08, 6);
        expect(lat).toBeCloseTo(n - (n - s) * 0.10, 6);
        expect((squares[0].properties as Props).text).toBe('35V LF');
    });

    it('spans two zones when the view crosses a zone boundary', () => {
        const grid = buildMgrsGrid([23.5, 59.1, 24.5, 59.5], 11);
        const squares = grid.features.map((f) => f.properties as Props).filter((p) => p.role === 'square').map((p) => p.text || '');
        expect(squares.some((t) => t.startsWith('34V'))).toBe(true);
        expect(squares.some((t) => t.startsWith('35V'))).toBe(true);
    });

    it('returns nothing when zoomed out across many zones', () => {
        expect(buildMgrsGrid([-30, 40, 40, 70], 4).features).toHaveLength(0);
    });

    it('returns nothing outside the UTM latitude range', () => {
        expect(buildMgrsGrid([10, 85, 20, 89], 12).features).toHaveLength(0);
    });
});
