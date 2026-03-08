#!/bin/bash

echo "EIA API Response Time Tests"
echo "============================"
echo ""

# Test 1: Historical date (should have data)
echo "Test 1: Historical date (2024-03-01) for NYISO"
START=$(date +%s)
RESPONSE=$(curl -s -m 15 "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/?api_key=${EIA_API_KEY}&data[0]=value&frequency=hourly&start=2024-03-01T00&end=2024-03-02T00&sort[0][column]=period&sort[0][direction]=asc&facets[respondent][]=NYIS")
END=$(date +%s)
DURATION=$((END - START))
COUNT=$(echo $RESPONSE | jq -r '.response.data | length' 2>/dev/null || echo "error")
echo "  Duration: ${DURATION}s"
echo "  Records returned: $COUNT"
echo ""

# Test 2: Recent date
echo "Test 2: Recent date (2026-03-06) for NYISO"
START=$(date +%s)
RESPONSE=$(curl -s -m 15 "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/?api_key=${EIA_API_KEY}&data[0]=value&frequency=hourly&start=2026-03-06T00&end=2026-03-07T00&sort[0][column]=period&sort[0][direction]=asc&facets[respondent][]=NYIS")
END=$(date +%s)
DURATION=$((END - START))
COUNT=$(echo $RESPONSE | jq -r '.response.data | length' 2>/dev/null || echo "error")
echo "  Duration: ${DURATION}s"
echo "  Records returned: $COUNT"
echo ""

# Test 3: Different ISO (ISONE)
echo "Test 3: ISONE (2024-03-01)"
START=$(date +%s)
RESPONSE=$(curl -s -m 15 "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/?api_key=${EIA_API_KEY}&data[0]=value&frequency=hourly&start=2024-03-01T00&end=2024-03-02T00&sort[0][column]=period&sort[0][direction]=asc&facets[respondent][]=ISNE")
END=$(date +%s)
DURATION=$((END - START))
COUNT=$(echo $RESPONSE | jq -r '.response.data | length' 2>/dev/null || echo "error")
echo "  Duration: ${DURATION}s"
echo "  Records returned: $COUNT"
echo ""

echo "Tests complete!"
