import area from "@turf/area";
import type { BAGeometryPolygonGeometry, BAGeometryFeature } from "@/types/energy";

/**
 * Calculate the area of a polygon or multipolygon geometry in square meters.
 * Uses Turf.js for accurate spherical geometry calculations.
 *
 * @param geometry - GeoJSON Polygon or MultiPolygon geometry
 * @returns Area in square meters
 */
export function calculatePolygonArea(
  geometry: BAGeometryPolygonGeometry
): number {
  try {
    // Turf.js area() accepts GeoJSON Feature or Geometry
    // We can pass the geometry directly
    const areaInSquareMeters = area({
      type: "Feature",
      geometry: geometry,
      properties: {},
    });
    return areaInSquareMeters;
  } catch (error) {
    console.error("Error calculating polygon area:", error);
    return Infinity; // Return large value so it's deprioritized
  }
}

/**
 * Sort BA features by area (smallest first).
 * Mutates the input array for performance.
 *
 * @param features - Array of BA geometry features
 * @returns The sorted array (same reference as input)
 */
export function sortBAFeaturesByArea(
  features: BAGeometryFeature[]
): BAGeometryFeature[] {
  return features.sort((a, b) => {
    const areaA = a.area ?? Infinity;
    const areaB = b.area ?? Infinity;
    return areaA - areaB; // Ascending: smallest first
  });
}

/**
 * Calculate and attach area to each BA feature.
 * Mutates the features by adding an 'area' property.
 *
 * @param features - Array of BA geometry features
 * @returns The same array with area properties attached
 */
export function attachAreaToFeatures(
  features: BAGeometryFeature[]
): BAGeometryFeature[] {
  features.forEach((feature) => {
    feature.area = calculatePolygonArea(feature.geometry);
  });
  return features;
}
