/**
 * Data Validation and Quality Reporting
 * 
 * Validates fuel mix and pricing data quality, providing detailed reports
 * with confidence scores, warnings, and errors.
 * 
 * Key features:
 * - Confidence scoring (high/medium/low/critical)
 * - Null vs zero distinction
 * - Missing hour detection
 * - Data completeness checks
 * - Anomaly detection (negative values, extreme outliers)
 */

import { HistoricalRecord, LMPDataPoint, EnergySource } from "@/types/energy";

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'critical';

export interface DataQualityReport {
  confidence: ConfidenceLevel;
  warnings: string[];
  errors: string[];
  missingHours: number[];
  totalHours: number;
  completenessPercent: number;
}

const FUEL_TYPES: EnergySource[] = [
  'solar', 'wind', 'hydro', 'geothermal', 'biomass', 'batteries', 'imports', 'other',
  'coal', 'gas', 'oil', 'nuclear'
];

/**
 * Validate fuel mix data and generate quality report
 * 
 * @param records - Array of hourly fuel mix records
 * @param expectedDate - Expected date in YYYY-MM-DD format
 * @returns Quality report with confidence level and issues
 */
export function validateFuelMixData(
  records: HistoricalRecord[],
  expectedDate: string
): DataQualityReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const missingHours: number[] = [];
  
  // Check for empty data
  if (!records || records.length === 0) {
    return {
      confidence: 'critical',
      warnings: [],
      errors: ['No data returned'],
      missingHours: Array.from({ length: 24 }, (_, i) => i),
      totalHours: 0,
      completenessPercent: 0,
    };
  }

  // Validate date format and consistency
  const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}/;
  const invalidDates = records.filter(r => !datePattern.test(r.date));
  if (invalidDates.length > 0) {
    errors.push(`Invalid date format in ${invalidDates.length} record(s)`);
  }

  // Check for hours outside expected date (allow hour 24 for next day's hour 0)
  const wrongDate = records.filter(r => {
    const isExpectedDate = r.date.startsWith(expectedDate);
    const isHour24 = r.date.includes('T24');
    return !isExpectedDate && !isHour24;
  });
  if (wrongDate.length > 0) {
    warnings.push(`${wrongDate.length} record(s) outside expected date ${expectedDate}`);
  }

  // Build hour map (0-24, where 24 is next day's hour 0)
  const hourMap = new Map<number, HistoricalRecord>();
  for (const record of records) {
    if (record.date.startsWith(expectedDate)) {
      const hourMatch = record.date.match(/T(\d{2})/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        if (hour >= 0 && hour <= 24) {
          hourMap.set(hour, record);
        }
      }
    }
  }

  // Identify missing hours (0-23 are required, 24 is optional)
  for (let hour = 0; hour < 24; hour++) {
    if (!hourMap.has(hour)) {
      missingHours.push(hour);
    }
  }

  const totalHours = hourMap.size;
  const completenessPercent = (totalHours / 25) * 100;

  // Check data completeness
  if (missingHours.length > 0) {
    if (missingHours.length <= 3) {
      warnings.push(`Missing ${missingHours.length} hour(s): ${missingHours.join(', ')}`);
    } else if (missingHours.length <= 12) {
      warnings.push(`Missing ${missingHours.length} hours (${completenessPercent.toFixed(0)}% complete)`);
    } else {
      errors.push(`Missing ${missingHours.length} hours (only ${completenessPercent.toFixed(0)}% complete)`);
    }
  }

  // Validate each record's fuel mix data
  let recordsWithAllNulls = 0;
  let recordsWithNegatives = 0;
  let recordsWithExtremes = 0;

  for (const [hour, record] of hourMap) {
    // Check if all fuel types are null (missing data)
    const fuelValues = FUEL_TYPES.map(fuel => record[fuel]);
    const allNull = fuelValues.every(v => v === null || v === undefined);
    
    if (allNull) {
      recordsWithAllNulls++;
      continue;
    }

    // Check for negative values (should not happen)
    const negatives = fuelValues.filter(v => typeof v === 'number' && v < 0);
    if (negatives.length > 0) {
      recordsWithNegatives++;
    }

    // Check for extreme values (>500 GW is unrealistic for any fuel type)
    const extremes = fuelValues.filter(v => typeof v === 'number' && v > 500);
    if (extremes.length > 0) {
      recordsWithExtremes++;
    }

    // Check for suspiciously low total generation
    const total = fuelValues.reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    if (total < 1 && total !== 0) {
      warnings.push(`Hour ${hour}: Very low total generation (${total.toFixed(2)} GW)`);
    }
  }

  // Report anomalies
  if (recordsWithAllNulls > 0) {
    if (recordsWithAllNulls <= 3) {
      warnings.push(`${recordsWithAllNulls} hour(s) with no fuel mix data`);
    } else {
      errors.push(`${recordsWithAllNulls} hours with no fuel mix data`);
    }
  }

  if (recordsWithNegatives > 0) {
    errors.push(`${recordsWithNegatives} hour(s) with negative generation values`);
  }

  if (recordsWithExtremes > 0) {
    warnings.push(`${recordsWithExtremes} hour(s) with extreme values (>500 GW)`);
  }

  // Determine confidence level
  const confidence = determineConfidence(
    completenessPercent,
    errors.length,
    warnings.length
  );

  return {
    confidence,
    warnings,
    errors,
    missingHours,
    totalHours,
    completenessPercent,
  };
}

/**
 * Validate pricing (LMP) data and generate quality report
 * 
 * @param records - Array of hourly LMP data points
 * @param expectedDate - Expected date in YYYY-MM-DD format
 * @returns Quality report with confidence level and issues
 */
export function validatePricingData(
  records: LMPDataPoint[],
  expectedDate: string
): DataQualityReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const missingHours: number[] = [];

  // Check for empty data
  if (!records || records.length === 0) {
    return {
      confidence: 'critical',
      warnings: [],
      errors: ['No pricing data returned'],
      missingHours: Array.from({ length: 24 }, (_, i) => i),
      totalHours: 0,
      completenessPercent: 0,
    };
  }

  // Validate date format
  const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}/;
  const invalidDates = records.filter(r => !datePattern.test(r.time));
  if (invalidDates.length > 0) {
    errors.push(`Invalid time format in ${invalidDates.length} record(s)`);
  }

  // Check for records outside expected date (allow hour 24 for next day's hour 0)
  const wrongDate = records.filter(r => {
    const isExpectedDate = r.time.startsWith(expectedDate);
    const isHour24 = r.time.includes('T24');
    return !isExpectedDate && !isHour24;
  });
  if (wrongDate.length > 0) {
    warnings.push(`${wrongDate.length} record(s) outside expected date ${expectedDate}`);
  }

  // Build hour map (0-24, where 24 is next day's hour 0)
  const hourMap = new Map<number, LMPDataPoint>();
  for (const record of records) {
    if (record.time.startsWith(expectedDate)) {
      const hourMatch = record.time.match(/T(\d{2})/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        if (hour >= 0 && hour <= 24) {
          hourMap.set(hour, record);
        }
      }
    }
  }

  // Identify missing hours (0-23 are required, 24 is optional)
  for (let hour = 0; hour < 24; hour++) {
    if (!hourMap.has(hour)) {
      missingHours.push(hour);
    }
  }

  const totalHours = hourMap.size;
  const completenessPercent = (totalHours / 25) * 100;

  // Check completeness
  if (missingHours.length > 0) {
    if (missingHours.length <= 3) {
      warnings.push(`Missing ${missingHours.length} hour(s): ${missingHours.join(', ')}`);
    } else {
      errors.push(`Missing ${missingHours.length} hours (${completenessPercent.toFixed(0)}% complete)`);
    }
  }

  // Validate LMP values
  let extremeNegatives = 0;
  let extremePositives = 0;
  let suspiciousZeros = 0;

  for (const [hour, point] of hourMap) {
    // Check for extreme negative prices (< -$500/MWh is unusual)
    if (point.lmp < -500) {
      extremeNegatives++;
    }

    // Check for extreme positive prices (> $1000/MWh is unusual but can happen)
    if (point.lmp > 1000) {
      extremePositives++;
    }

    // Check for suspicious zeros (all components zero is unusual)
    if (point.lmp === 0 && point.energy === 0 && point.congestion === 0 && point.loss === 0) {
      suspiciousZeros++;
    }

    // Validate components sum approximately to LMP
    const componentSum = point.energy + point.congestion + point.loss;
    const diff = Math.abs(point.lmp - componentSum);
    if (diff > 1.0) {
      warnings.push(`Hour ${hour}: LMP components don't sum correctly (diff: $${diff.toFixed(2)})`);
    }
  }

  // Report anomalies
  if (extremeNegatives > 0) {
    warnings.push(`${extremeNegatives} hour(s) with extreme negative prices (< -$500/MWh)`);
  }

  if (extremePositives > 0) {
    warnings.push(`${extremePositives} hour(s) with extreme positive prices (> $1000/MWh)`);
  }

  if (suspiciousZeros > 0) {
    warnings.push(`${suspiciousZeros} hour(s) with all zero values`);
  }

  // Determine confidence level
  const confidence = determineConfidence(
    completenessPercent,
    errors.length,
    warnings.length
  );

  return {
    confidence,
    warnings,
    errors,
    missingHours,
    totalHours,
    completenessPercent,
  };
}

/**
 * Determine overall confidence level based on completeness and issues
 */
function determineConfidence(
  completenessPercent: number,
  errorCount: number,
  warningCount: number
): ConfidenceLevel {
  // Critical: Major errors or <50% complete
  if (errorCount > 0 || completenessPercent < 50) {
    return 'critical';
  }

  // High: 100% complete with no warnings
  if (completenessPercent === 100 && warningCount === 0) {
    return 'high';
  }

  // Medium: 85-100% complete with few warnings
  if (completenessPercent >= 85 && warningCount <= 2) {
    return 'medium';
  }

  // Low: Everything else (50-85% complete or many warnings)
  return 'low';
}

/**
 * Generate human-readable quality summary
 */
export function generateQualitySummary(report: DataQualityReport): string {
  if (report.confidence === 'critical') {
    return `Data quality is critical. ${report.errors.join('. ')}`;
  }

  if (report.confidence === 'high') {
    return `Data quality is high (${report.totalHours}/25 hours, ${report.completenessPercent.toFixed(0)}% complete)`;
  }

  if (report.confidence === 'medium') {
    const issues = [...report.errors, ...report.warnings];
    return `Data quality is medium (${report.totalHours}/25 hours). ${issues.slice(0, 2).join('. ')}`;
  }

  // Low confidence
  const issues = [...report.errors, ...report.warnings];
  return `Data quality is low (${report.totalHours}/25 hours). ${issues.slice(0, 3).join('. ')}`;
}
