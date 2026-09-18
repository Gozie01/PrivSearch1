require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT_ROOT = path.resolve('C:/Users/Gozie/Desktop/Datasets/openFDA');
const INPUT_ROOT = process.env.OPENFDA_INPUT_ROOT || DEFAULT_INPUT_ROOT;
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'openfda');

const ENFORCEMENT_INPUT = path.join(INPUT_ROOT, 'drug-enforcement', 'drug-enforcement-0001-of-0001.json');
const NDC_INPUT = path.join(INPUT_ROOT, 'drug-ndc', 'drug-ndc-0001-of-0001.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

function formatDate(value) {
  if (!value || typeof value !== 'string' || value.length !== 8) {
    return '';
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
  }
  return String(value).trim() ? [value] : [];
}

function joinArray(value) {
  return normalizeArray(value).map((item) => String(item).replace(/\s+/g, ' ').trim()).join('|');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column] ?? '')).join(','));
  }
  return lines.join('\n');
}

function writeJsonl(filePath, rows) {
  const lines = rows.map((row) => JSON.stringify(row));
  writeText(filePath, lines.join('\n'));
}

function buildSearchText(parts) {
  return parts
    .flatMap((part) => normalizeArray(part))
    .map((part) => String(part).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function flattenEnforcement(row) {
  const openfda = row.openfda || {};
  const productNdcs = normalizeArray(openfda.product_ndc);
  const packageNdcs = normalizeArray(openfda.package_ndc);
  const brandNames = normalizeArray(openfda.brand_name);
  const genericNames = normalizeArray(openfda.generic_name);
  const manufacturerNames = normalizeArray(openfda.manufacturer_name);
  const routes = normalizeArray(openfda.route);
  const substanceNames = normalizeArray(openfda.substance_name);
  const applicationNumbers = normalizeArray(openfda.application_number);
  const productTypes = normalizeArray(openfda.product_type);

  return {
    recall_number: row.recall_number || '',
    event_id: row.event_id || '',
    status: row.status || '',
    classification: row.classification || '',
    product_type: row.product_type || joinArray(productTypes),
    report_date: formatDate(row.report_date),
    recall_initiation_date: formatDate(row.recall_initiation_date),
    termination_date: formatDate(row.termination_date),
    center_classification_date: formatDate(row.center_classification_date),
    voluntary_mandated: row.voluntary_mandated || '',
    initial_firm_notification: row.initial_firm_notification || '',
    recalling_firm: row.recalling_firm || '',
    city: row.city || '',
    state: row.state || '',
    postal_code: row.postal_code || '',
    country: row.country || '',
    address_1: row.address_1 || '',
    address_2: row.address_2 || '',
    code_info: row.code_info || '',
    product_quantity: row.product_quantity || '',
    distribution_pattern: row.distribution_pattern || '',
    reason_for_recall: row.reason_for_recall || '',
    product_description: row.product_description || '',
    brand_names: joinArray(brandNames),
    generic_names: joinArray(genericNames),
    manufacturer_names: joinArray(manufacturerNames),
    product_ndcs: joinArray(productNdcs),
    package_ndcs: joinArray(packageNdcs),
    routes: joinArray(routes),
    substance_names: joinArray(substanceNames),
    application_numbers: joinArray(applicationNumbers),
    rxcuis: joinArray(openfda.rxcui),
    spl_ids: joinArray(openfda.spl_id),
    spl_set_ids: joinArray(openfda.spl_set_id),
    unii: joinArray(openfda.unii),
    upc: joinArray(openfda.upc),
    search_text: buildSearchText([
      row.product_description,
      row.reason_for_recall,
      row.code_info,
      row.recalling_firm,
      brandNames,
      genericNames,
      manufacturerNames,
      productNdcs,
      packageNdcs,
      routes,
      substanceNames,
      applicationNumbers,
      row.city,
      row.state,
      row.country,
    ]),
  };
}

function flattenNdc(row) {
  const activeIngredients = normalizeArray(row.active_ingredients).map((item) => {
    if (!item || typeof item !== 'object') {
      return String(item);
    }
    return `${item.name || ''}:${item.strength || ''}`.replace(/:$/, '');
  });

  return {
    product_ndc: row.product_ndc || '',
    product_id: row.product_id || '',
    brand_name: row.brand_name || '',
    brand_name_base: row.brand_name_base || '',
    generic_name: row.generic_name || '',
    labeler_name: row.labeler_name || '',
    manufacturer_name: row.labeler_name || '',
    dosage_form: row.dosage_form || '',
    route: joinArray(row.route),
    product_type: row.product_type || '',
    marketing_category: row.marketing_category || '',
    application_number: row.application_number || '',
    dea_schedule: row.dea_schedule || '',
    listing_expiration_date: formatDate(row.listing_expiration_date),
    marketing_start_date: formatDate(row.marketing_start_date),
    finished: row.finished || '',
    package_descriptions: normalizeArray(row.packaging).map((item) => item.description || '').filter(Boolean).join('|'),
    package_ndcs: normalizeArray(row.packaging).map((item) => item.package_ndc || '').filter(Boolean).join('|'),
    active_ingredients: activeIngredients.join('|'),
    pharm_class: joinArray(row.pharm_class),
    spl_id: row.spl_id || '',
    search_text: buildSearchText([
      row.product_ndc,
      row.brand_name,
      row.brand_name_base,
      row.generic_name,
      row.labeler_name,
      row.dosage_form,
      row.product_type,
      row.marketing_category,
      row.application_number,
      row.dea_schedule,
      activeIngredients,
      row.route,
    ]),
  };
}

function buildNdcLookup(ndcRows) {
  const lookup = new Map();
  for (const row of ndcRows) {
    lookup.set(row.product_ndc, row);
  }
  return lookup;
}

function expandRecallProducts(enforcementRows, ndcLookup) {
  const expanded = [];

  for (const recall of enforcementRows) {
    const productNdcs = normalizeArray(recall.product_ndcs.split('|').filter(Boolean));
    const packageNdcs = normalizeArray(recall.package_ndcs.split('|').filter(Boolean));

    if (!productNdcs.length) {
      expanded.push({
        recall_number: recall.recall_number,
        event_id: recall.event_id,
        classification: recall.classification,
        status: recall.status,
        report_date: recall.report_date,
        recall_initiation_date: recall.recall_initiation_date,
        product_ndc: '',
        package_ndcs: packageNdcs.join('|'),
        brand_name: recall.brand_names,
        generic_name: recall.generic_names,
        manufacturer_name: recall.manufacturer_names,
        route: recall.routes,
        product_type: recall.product_type,
        reason_for_recall: recall.reason_for_recall,
        product_description: recall.product_description,
        code_info: recall.code_info,
        recalling_firm: recall.recalling_firm,
        search_text: recall.search_text,
      });
      continue;
    }

    for (const productNdc of productNdcs) {
      const ndc = ndcLookup.get(productNdc);
      const relatedPackages = packageNdcs.filter((packageNdc) => packageNdc.startsWith(`${productNdc}-`));
      expanded.push({
        recall_number: recall.recall_number,
        event_id: recall.event_id,
        classification: recall.classification,
        status: recall.status,
        report_date: recall.report_date,
        recall_initiation_date: recall.recall_initiation_date,
        product_ndc: productNdc,
        package_ndcs: relatedPackages.join('|'),
        brand_name: ndc?.brand_name || recall.brand_names,
        generic_name: ndc?.generic_name || recall.generic_names,
        manufacturer_name: ndc?.manufacturer_name || recall.manufacturer_names,
        route: ndc?.route || recall.routes,
        product_type: ndc?.product_type || recall.product_type,
        reason_for_recall: recall.reason_for_recall,
        product_description: recall.product_description,
        code_info: recall.code_info,
        recalling_firm: recall.recalling_firm,
        search_text: buildSearchText([
          productNdc,
          relatedPackages,
          ndc?.brand_name,
          ndc?.generic_name,
          ndc?.manufacturer_name,
          recall.reason_for_recall,
          recall.product_description,
          recall.code_info,
          recall.recalling_firm,
        ]),
      });
    }
  }

  return expanded;
}

function summarize(enforcementRows, ndcRows, recallProductRows) {
  const uniqueRecallNumbers = new Set(enforcementRows.map((row) => row.recall_number).filter(Boolean));
  const uniqueProductNdcs = new Set(ndcRows.map((row) => row.product_ndc).filter(Boolean));
  const classifiedRecallCounts = {};

  for (const row of enforcementRows) {
    const key = row.classification || 'UNKNOWN';
    classifiedRecallCounts[key] = (classifiedRecallCounts[key] || 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    source: {
      enforcement_input: ENFORCEMENT_INPUT,
      ndc_input: NDC_INPUT,
    },
    counts: {
      enforcement_rows: enforcementRows.length,
      ndc_rows: ndcRows.length,
      recall_product_rows: recallProductRows.length,
      unique_recall_numbers: uniqueRecallNumbers.size,
      unique_product_ndcs: uniqueProductNdcs.size,
    },
    recall_classification_breakdown: classifiedRecallCounts,
  };
}

function main() {
  if (!fs.existsSync(ENFORCEMENT_INPUT)) {
    throw new Error(`Missing enforcement input: ${ENFORCEMENT_INPUT}`);
  }
  if (!fs.existsSync(NDC_INPUT)) {
    throw new Error(`Missing NDC input: ${NDC_INPUT}`);
  }

  ensureDir(OUTPUT_ROOT);

  const enforcementRaw = readJson(ENFORCEMENT_INPUT).results || [];
  const ndcRaw = readJson(NDC_INPUT).results || [];

  const enforcementRows = enforcementRaw.map(flattenEnforcement);
  const ndcRows = ndcRaw.map(flattenNdc);
  const ndcLookup = buildNdcLookup(ndcRows);
  const recallProductRows = expandRecallProducts(enforcementRows, ndcLookup);
  const summary = summarize(enforcementRows, ndcRows, recallProductRows);

  const enforcementColumns = Object.keys(enforcementRows[0] || {});
  const ndcColumns = Object.keys(ndcRows[0] || {});
  const recallProductColumns = Object.keys(recallProductRows[0] || {});

  writeText(path.join(OUTPUT_ROOT, 'openfda_enforcement.csv'), toCsv(enforcementRows, enforcementColumns));
  writeJsonl(path.join(OUTPUT_ROOT, 'openfda_enforcement.jsonl'), enforcementRows);

  writeText(path.join(OUTPUT_ROOT, 'openfda_ndc.csv'), toCsv(ndcRows, ndcColumns));
  writeJsonl(path.join(OUTPUT_ROOT, 'openfda_ndc.jsonl'), ndcRows);

  writeText(path.join(OUTPUT_ROOT, 'openfda_recall_products.csv'), toCsv(recallProductRows, recallProductColumns));
  writeJsonl(path.join(OUTPUT_ROOT, 'openfda_recall_products.jsonl'), recallProductRows);

  writeJson(path.join(OUTPUT_ROOT, 'openfda_summary.json'), summary);

  console.log(`Prepared openFDA outputs in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
