require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'healthcare');

const EICU_ROOT = process.env.EICU_INPUT_ROOT
  || 'C:/Users/Gozie/Desktop/Blockchain in Clinical Trial/Fedlearn/MIMIC Dataset/eicu-collaborative-research-database-demo-2.0.1';
const MEDCD_ROOT = process.env.MEDCD_INPUT_ROOT
  || 'C:/Users/Gozie/Desktop/PR-RemoteCare/MedCD';
const OPENFDA_ROOT = process.env.OPENFDA_INPUT_ROOT
  || path.join(ROOT, 'NweDB', 'openfda');

const EICU_FILES = {
  hospital: path.join(EICU_ROOT, 'hospital.csv.gz'),
  patient: path.join(EICU_ROOT, 'patient.csv.gz'),
  diagnosis: path.join(EICU_ROOT, 'diagnosis.csv.gz'),
  medication: path.join(EICU_ROOT, 'medication.csv.gz'),
  nurseCharting: path.join(EICU_ROOT, 'nurseCharting.csv.gz'),
  vitalPeriodic: path.join(EICU_ROOT, 'vitalPeriodic.csv.gz'),
};

const MEDCD_FILES = {
  searchNotes: path.join(MEDCD_ROOT, 'medcd-annotations', 'medcd_search_notes.csv'),
  searchQueries: path.join(MEDCD_ROOT, 'medcd-annotations', 'medcd_search_queries.csv'),
};
const OPENFDA_FILES = {
  enforcement: path.join(OPENFDA_ROOT, 'openfda_enforcement.jsonl'),
  ndc: path.join(OPENFDA_ROOT, 'openfda_ndc.jsonl'),
  recallProducts: path.join(OPENFDA_ROOT, 'openfda_recall_products.jsonl'),
};

const EICU_OUTPUT = path.join(OUTPUT_ROOT, 'eicu_demo');
const MEDCD_OUTPUT = path.join(OUTPUT_ROOT, 'medcd');
const OPENFDA_OUTPUT = path.join(OUTPUT_ROOT, 'openfda');
const COMBINED_OUTPUT = path.join(OUTPUT_ROOT, 'combined');
const EVENT_SAMPLE_LIMIT_PER_STREAM = Number(process.env.HEALTHCARE_EVENT_SAMPLE_LIMIT || '750');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeJsonl(filePath, rows) {
  const lines = rows.map((row) => JSON.stringify(row));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsvText(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(current);
      current = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function rowObject(headers, values) {
  const row = {};
  for (let i = 0; i < headers.length; i += 1) {
    row[headers[i]] = values[i] ?? '';
  }
  return row;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' ')
    .trim();
}

function normalizeIsoDate(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00.000Z`).toISOString();
  }
  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return '';
}

function joinParts(parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');
}

function normalizeDelimited(value, delimiter = '|') {
  return String(value ?? '')
    .split(delimiter)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeMedcdDate(value) {
  const raw = normalizeText(value).replace(/，/g, ' ');
  if (!raw) {
    return '';
  }

  let normalized = raw.replace(/\//g, '-');
  normalized = normalized.replace(/\s+/g, ' ');
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map((part) => Number(part));
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return '';
}

function buildSyntheticEicuIso(yearValue, offsetMinutes) {
  const year = Number(yearValue) || 2015;
  const offset = Number(offsetMinutes) || 0;
  const base = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  return new Date(base + (offset * 60 * 1000)).toISOString();
}

async function forEachGzipCsvRow(filePath, onRow) {
  const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let headers = null;
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    await onRow(rowObject(headers, parseCsvLine(line)));
  }
}

async function loadEicuHospitals() {
  const hospitals = new Map();
  await forEachGzipCsvRow(EICU_FILES.hospital, async (row) => {
    const hospitalId = String(row.hospitalid || '').trim();
    if (!hospitalId) {
      return;
    }
    hospitals.set(hospitalId, row);
  });
  return hospitals;
}

async function loadEicuPatients(hospitals) {
  const patients = [];
  const patientLookup = new Map();
  await forEachGzipCsvRow(EICU_FILES.patient, async (row) => {
    const patientUnitStayId = String(row.patientunitstayid || '').trim();
    if (!patientUnitStayId) {
      return;
    }

    const hospitalRow = hospitals.get(String(row.hospitalid || '').trim()) || {};
    const patientId = `eicu:${row.patienthealthsystemstayid || patientUnitStayId}`;
    const facilityId = `eicu-hospital:${row.hospitalid || 'unknown'}`;
    const unitType = normalizeText(row.unittype);
    const diagnosisHint = normalizeText(row.apacheadmissiondx);
    const admissionIso = buildSyntheticEicuIso(row.hospitaldischargeyear, row.hospitaladmitoffset);

    const normalized = {
      patient_id: patientId,
      unit_stay_id: patientUnitStayId,
      health_system_stay_id: String(row.patienthealthsystemstayid || ''),
      gender: normalizeText(row.gender).toUpperCase(),
      age: normalizeText(row.age),
      ethnicity: normalizeText(row.ethnicity),
      facility_id: facilityId,
      facility_name: normalizeText(hospitalRow.hospitalnumbeds ? `hospital ${row.hospitalid}` : `hospital ${row.hospitalid}`),
      hospital_id: String(row.hospitalid || ''),
      ward_id: String(row.wardid || ''),
      unit_type: unitType,
      admit_source: normalizeText(row.unitadmitsource || row.hospitaladmitsource),
      discharge_location: normalizeText(row.unitdischargelocation || row.hospitaldischargelocation),
      admission_dx_hint: diagnosisHint,
      admit_time_iso: admissionIso,
      search_text: joinParts([
        patientId,
        unitType,
        diagnosisHint,
        row.gender,
        row.age,
        row.ethnicity,
        row.unitadmitsource,
        row.unitdischargelocation,
      ]),
      metadata: {
        dataset: 'eicu_demo',
        record_family: 'patient',
        unique_pid: String(row.uniquepid || ''),
        hospital_discharge_year: String(row.hospitaldischargeyear || ''),
        admit_offset_minutes: Number(row.hospitaladmitoffset || '0'),
        unit_discharge_offset_minutes: Number(row.unitdischargeoffset || '0'),
      },
    };

    patients.push(normalized);
    patientLookup.set(patientUnitStayId, normalized);
  });

  return { patients, patientLookup };
}

function makeEicuCorpusDoc(base) {
  return {
    doc_id: base.doc_id,
    dataset: 'eicu_demo',
    patient_id: base.patient_id,
    facility_id: base.facility_id || '',
    record_type: base.record_type,
    date: base.date,
    title: base.title,
    search_text: base.search_text,
    metadata: base.metadata,
  };
}

async function loadEicuDiagnosisRecords(patientLookup) {
  const records = [];
  const corpus = [];
  await forEachGzipCsvRow(EICU_FILES.diagnosis, async (row) => {
    const stayId = String(row.patientunitstayid || '').trim();
    const patient = patientLookup.get(stayId);
    if (!patient) {
      return;
    }

    const diagnosisString = normalizeText(row.diagnosisstring);
    const icdCodes = normalizeDelimited(row.icd9code, ',');
    const priority = normalizeText(row.diagnosispriority);
    const docId = `eicu:diagnosis:${row.diagnosisid || `${stayId}:${row.diagnosisoffset || records.length}`}`;
    const dateIso = buildSyntheticEicuIso(patient.metadata.hospital_discharge_year, row.diagnosisoffset);
    const searchText = joinParts([
      diagnosisString,
      icdCodes,
      priority,
      patient.unit_type,
      patient.ethnicity,
      patient.admission_dx_hint,
    ]);

    const normalized = {
      doc_id: docId,
      patient_id: patient.patient_id,
      unit_stay_id: stayId,
      facility_id: patient.facility_id,
      record_type: 'DIAGNOSIS',
      title: diagnosisString || 'Diagnosis',
      date: dateIso,
      search_text: searchText,
      diagnosis_string: diagnosisString,
      diagnosis_codes: icdCodes,
      priority,
      metadata: {
        dataset: 'eicu_demo',
        active_upon_discharge: String(row.activeupondischarge || ''),
        diagnosis_offset_minutes: Number(row.diagnosisoffset || '0'),
      },
    };

    records.push(normalized);
    corpus.push(makeEicuCorpusDoc(normalized));
  });
  return { records, corpus };
}

async function loadEicuMedicationRecords(patientLookup) {
  const records = [];
  const corpus = [];
  await forEachGzipCsvRow(EICU_FILES.medication, async (row) => {
    const stayId = String(row.patientunitstayid || '').trim();
    const patient = patientLookup.get(stayId);
    if (!patient) {
      return;
    }

    const drugName = normalizeText(row.drugname);
    const dosage = normalizeText(row.dosage);
    const route = normalizeText(row.routeadmin);
    const frequency = normalizeText(row.frequency);
    const docId = `eicu:medication:${row.medicationid || `${stayId}:${row.drugstartoffset || records.length}`}`;
    const dateIso = buildSyntheticEicuIso(patient.metadata.hospital_discharge_year, row.drugstartoffset || row.drugorderoffset);
    const searchText = joinParts([
      drugName,
      dosage,
      route,
      frequency,
      patient.admission_dx_hint,
      patient.unit_type,
    ]);

    const normalized = {
      doc_id: docId,
      patient_id: patient.patient_id,
      unit_stay_id: stayId,
      facility_id: patient.facility_id,
      record_type: 'PRESCRIPTION',
      title: drugName || 'Medication',
      date: dateIso,
      search_text: searchText,
      drug_name: drugName,
      dosage,
      route,
      frequency,
      metadata: {
        dataset: 'eicu_demo',
        drug_order_offset_minutes: Number(row.drugorderoffset || '0'),
        drug_start_offset_minutes: Number(row.drugstartoffset || '0'),
        drug_stop_offset_minutes: Number(row.drugstopoffset || '0'),
        prn: normalizeText(row.prn),
      },
    };

    records.push(normalized);
    corpus.push(makeEicuCorpusDoc(normalized));
  });
  return { records, corpus };
}

async function loadEicuReplayCandidates(patientLookup) {
  const candidates = [];
  let nurseCount = 0;
  let vitalCount = 0;

  if (fs.existsSync(EICU_FILES.nurseCharting)) {
    await forEachGzipCsvRow(EICU_FILES.nurseCharting, async (row) => {
      if (nurseCount >= EVENT_SAMPLE_LIMIT_PER_STREAM) {
        return;
      }
      const stayId = String(row.patientunitstayid || '').trim();
      const patient = patientLookup.get(stayId);
      if (!patient) {
        return;
      }
      nurseCount += 1;
      candidates.push({
        event_id: `eicu:nurse:${row.nursingchartid || nurseCount}`,
        patient_id: patient.patient_id,
        facility_id: patient.facility_id,
        stream: 'nurseCharting',
        timestamp_iso: buildSyntheticEicuIso(patient.metadata.hospital_discharge_year, row.nursingchartoffset),
        event_label: normalizeText(row.nursingchartcelltypevallabel),
        event_value: normalizeText(row.nursingchartvalue),
        nonce_seed: `nurse:${row.nursingchartid || nurseCount}:${stayId}`,
      });
    });
  }

  if (fs.existsSync(EICU_FILES.vitalPeriodic)) {
    await forEachGzipCsvRow(EICU_FILES.vitalPeriodic, async (row) => {
      if (vitalCount >= EVENT_SAMPLE_LIMIT_PER_STREAM) {
        return;
      }
      const stayId = String(row.patientunitstayid || '').trim();
      const patient = patientLookup.get(stayId);
      if (!patient) {
        return;
      }
      vitalCount += 1;
      const measurementParts = [
        row.temperature,
        row.sao2,
        row.heartrate,
        row.respiration,
        row.systemicsystolic,
      ].map((value) => normalizeText(value)).filter(Boolean);

      candidates.push({
        event_id: `eicu:vital:${stayId}:${row.observationoffset || vitalCount}`,
        patient_id: patient.patient_id,
        facility_id: patient.facility_id,
        stream: 'vitalPeriodic',
        timestamp_iso: buildSyntheticEicuIso(patient.metadata.hospital_discharge_year, row.observationoffset),
        event_label: 'vital_periodic',
        event_value: measurementParts.join('|'),
        nonce_seed: `vital:${stayId}:${row.observationoffset || vitalCount}`,
      });
    });
  }

  return candidates;
}

function loadMedcdRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsvText(text);
  if (!rows.length) {
    return [];
  }
  const headers = rows[0];
  return rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== '')).map((row) => rowObject(headers, row));
}

function loadMedcdArtifacts() {
  const noteRows = loadMedcdRows(MEDCD_FILES.searchNotes);
  const queryRows = loadMedcdRows(MEDCD_FILES.searchQueries);

  const notes = noteRows.map((row, index) => {
    const subjectId = String(row.subject_id || `medcd-subject-${index + 1}`);
    const hadmId = String(row.hadm_id || index + 1);
    const docId = `medcd:${subjectId}:${hadmId}`;
    const searchText = joinParts([
      row.diagnosis,
      row.admission_diagnosis,
      row.discharge_diagnosis,
      row.hospital_course,
      row.discharge_instructions,
      row.followup_instructions,
      row.department,
    ]);

    return {
      doc_id: docId,
      patient_id: `medcd:${subjectId}`,
      encounter_id: hadmId,
      facility_id: normalizeText(row.department) ? `medcd-dept:${normalizeText(row.department)}` : '',
      record_type: 'NOTES',
      title: normalizeText(row.diagnosis) || normalizeText(row.admission_diagnosis) || 'Clinical note',
      date: normalizeMedcdDate(row.admission_date) || normalizeMedcdDate(row.discharge_date),
      search_text: searchText,
      diagnosis: normalizeText(row.diagnosis),
      admission_diagnosis: normalizeText(row.admission_diagnosis),
      discharge_diagnosis: normalizeText(row.discharge_diagnosis),
      metadata: {
        dataset: 'medcd',
        gender: normalizeText(row.gender),
        department: normalizeText(row.department),
        admission_condition: normalizeText(row.admission_condition),
        discharge_condition: normalizeText(row.discharge_condition),
        days_in_hospital: normalizeText(row.days_in_hospital),
      },
    };
  });

  const queries = queryRows.map((row, index) => ({
    query_id: `medcd-query-${String(index + 1).padStart(3, '0')}`,
    query_text: normalizeText(row.query),
  })).filter((row) => row.query_text);

  return { notes, queries };
}

function loadJsonlRows(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function loadOpenfdaArtifacts() {
  const enforcementRows = fs.existsSync(OPENFDA_FILES.enforcement)
    ? loadJsonlRows(OPENFDA_FILES.enforcement)
    : [];
  const ndcRows = fs.existsSync(OPENFDA_FILES.ndc)
    ? loadJsonlRows(OPENFDA_FILES.ndc)
    : [];
  const recallProductRows = fs.existsSync(OPENFDA_FILES.recallProducts)
    ? loadJsonlRows(OPENFDA_FILES.recallProducts)
    : [];

  const enforcementDocs = enforcementRows.map((row, index) => ({
    doc_id: `openfda:enforcement:${row.recall_number || row.event_id || index + 1}`,
    dataset: 'openfda',
    patient_id: '',
    facility_id: normalizeText(row.recalling_firm) ? `openfda-firm:${normalizeText(row.recalling_firm)}` : '',
    record_type: 'FDA_ENFORCEMENT',
    date: normalizeIsoDate(row.report_date)
      || normalizeIsoDate(row.center_classification_date)
      || normalizeIsoDate(row.recall_initiation_date),
    title: normalizeText(row.brand_names) || normalizeText(row.generic_names) || normalizeText(row.product_description) || 'openFDA enforcement record',
    search_text: normalizeText(row.search_text) || joinParts([
      row.product_description,
      row.reason_for_recall,
      row.brand_names,
      row.generic_names,
      row.manufacturer_names,
      row.routes,
    ]),
    metadata: {
      dataset: 'openfda',
      source_file: 'openfda_enforcement.jsonl',
      recall_number: normalizeText(row.recall_number),
      event_id: normalizeText(row.event_id),
      classification: normalizeText(row.classification),
      status: normalizeText(row.status),
      product_type: normalizeText(row.product_type),
      route: normalizeText(row.routes),
      manufacturer_name: normalizeText(row.manufacturer_names || row.recalling_firm),
      state: normalizeText(row.state),
      country: normalizeText(row.country),
    },
  }));

  const ndcDocs = ndcRows.map((row, index) => ({
    doc_id: `openfda:ndc:${row.product_id || row.product_ndc || index + 1}`,
    dataset: 'openfda',
    patient_id: '',
    facility_id: normalizeText(row.labeler_name || row.manufacturer_name) ? `openfda-labeler:${normalizeText(row.labeler_name || row.manufacturer_name)}` : '',
    record_type: 'FDA_NDC',
    date: normalizeIsoDate(row.marketing_start_date) || normalizeIsoDate(row.listing_expiration_date),
    title: normalizeText(row.brand_name) || normalizeText(row.generic_name) || normalizeText(row.product_ndc) || 'openFDA NDC record',
    search_text: normalizeText(row.search_text) || joinParts([
      row.product_ndc,
      row.brand_name,
      row.generic_name,
      row.labeler_name,
      row.active_ingredients,
      row.route,
      row.product_type,
    ]),
    metadata: {
      dataset: 'openfda',
      source_file: 'openfda_ndc.jsonl',
      product_ndc: normalizeText(row.product_ndc),
      product_id: normalizeText(row.product_id),
      route: normalizeText(row.route),
      dosage_form: normalizeText(row.dosage_form),
      product_type: normalizeText(row.product_type),
      marketing_category: normalizeText(row.marketing_category),
      application_number: normalizeText(row.application_number),
      labeler_name: normalizeText(row.labeler_name),
      manufacturer_name: normalizeText(row.manufacturer_name),
    },
  }));

  const recallProductDocs = recallProductRows.map((row, index) => ({
    doc_id: `openfda:recall-product:${row.recall_number || row.event_id || index + 1}:${row.product_ndc || index + 1}`,
    dataset: 'openfda',
    patient_id: '',
    facility_id: normalizeText(row.recalling_firm || row.manufacturer_name) ? `openfda-firm:${normalizeText(row.recalling_firm || row.manufacturer_name)}` : '',
    record_type: 'FDA_RECALL_PRODUCT',
    date: normalizeIsoDate(row.report_date) || normalizeIsoDate(row.recall_initiation_date),
    title: normalizeText(row.brand_name) || normalizeText(row.generic_name) || normalizeText(row.product_ndc) || 'openFDA recall product record',
    search_text: normalizeText(row.search_text) || joinParts([
      row.product_ndc,
      row.brand_name,
      row.generic_name,
      row.reason_for_recall,
      row.product_description,
      row.manufacturer_name,
      row.route,
    ]),
    metadata: {
      dataset: 'openfda',
      source_file: 'openfda_recall_products.jsonl',
      recall_number: normalizeText(row.recall_number),
      event_id: normalizeText(row.event_id),
      classification: normalizeText(row.classification),
      status: normalizeText(row.status),
      product_ndc: normalizeText(row.product_ndc),
      package_ndcs: normalizeText(row.package_ndcs),
      route: normalizeText(row.route),
      product_type: normalizeText(row.product_type),
      manufacturer_name: normalizeText(row.manufacturer_name || row.recalling_firm),
    },
  }));

  return {
    enforcementDocs,
    ndcDocs,
    recallProductDocs,
    corpus: [
      ...enforcementDocs,
      ...ndcDocs,
      ...recallProductDocs,
    ],
  };
}

function buildSummary(summary) {
  return [
    '# Healthcare Dataset Preparation Summary',
    '',
    `Generated: ${summary.generated_at}`,
    '',
    '## eICU Demo',
    '',
    `- Patients normalized: ${summary.eicu.patients}`,
    `- Diagnosis records normalized: ${summary.eicu.diagnosis_records}`,
    `- Medication records normalized: ${summary.eicu.medication_records}`,
    `- Replay-event candidates sampled: ${summary.eicu.replay_event_candidates}`,
    `- Combined eICU corpus documents: ${summary.eicu.corpus_documents}`,
    '',
    '## MedCD',
    '',
    `- Search-note records normalized: ${summary.medcd.notes}`,
    `- Search queries normalized: ${summary.medcd.queries}`,
    '',
    '## openFDA',
    '',
    `- Enforcement records normalized: ${summary.openfda.enforcement_records}`,
    `- NDC records normalized: ${summary.openfda.ndc_records}`,
    `- Recall-product records normalized: ${summary.openfda.recall_product_records}`,
    `- Combined openFDA corpus documents: ${summary.openfda.corpus_documents}`,
    '',
    '## Combined Corpus',
    '',
    `- Total PrivSearch-ready healthcare corpus docs: ${summary.combined.total_documents}`,
    '',
    '## Output Paths',
    '',
    `- eICU normalized root: ${summary.eicu.output_root}`,
    `- MedCD normalized root: ${summary.medcd.output_root}`,
    `- openFDA normalized root: ${summary.openfda.output_root}`,
    `- Combined corpus root: ${summary.combined.output_root}`,
  ].join('\n');
}

async function main() {
  if (!fs.existsSync(EICU_ROOT)) {
    throw new Error(`eICU input root not found: ${EICU_ROOT}`);
  }
  if (!fs.existsSync(MEDCD_ROOT)) {
    throw new Error(`MedCD input root not found: ${MEDCD_ROOT}`);
  }
  if (!fs.existsSync(OPENFDA_ROOT)) {
    throw new Error(`openFDA input root not found: ${OPENFDA_ROOT}`);
  }

  ensureDir(EICU_OUTPUT);
  ensureDir(MEDCD_OUTPUT);
  ensureDir(OPENFDA_OUTPUT);
  ensureDir(COMBINED_OUTPUT);

  const hospitals = await loadEicuHospitals();
  const { patients, patientLookup } = await loadEicuPatients(hospitals);
  const { records: diagnosisRecords, corpus: diagnosisCorpus } = await loadEicuDiagnosisRecords(patientLookup);
  const { records: medicationRecords, corpus: medicationCorpus } = await loadEicuMedicationRecords(patientLookup);
  const replayCandidates = await loadEicuReplayCandidates(patientLookup);
  const { notes: medcdNotes, queries: medcdQueries } = loadMedcdArtifacts();
  const openfda = loadOpenfdaArtifacts();

  const eicuCorpus = [...diagnosisCorpus, ...medicationCorpus];
  const combinedCorpus = [
    ...eicuCorpus,
    ...medcdNotes.map((row) => ({
      doc_id: row.doc_id,
      dataset: 'medcd',
      patient_id: row.patient_id,
      facility_id: row.facility_id,
      record_type: row.record_type,
      date: row.date,
      title: row.title,
      search_text: row.search_text,
      metadata: row.metadata,
    })),
    ...openfda.corpus,
  ];

  writeJsonl(path.join(EICU_OUTPUT, 'patients.jsonl'), patients);
  writeJsonl(path.join(EICU_OUTPUT, 'diagnosis_records.jsonl'), diagnosisRecords);
  writeJsonl(path.join(EICU_OUTPUT, 'medication_records.jsonl'), medicationRecords);
  writeJsonl(path.join(EICU_OUTPUT, 'replay_event_candidates.jsonl'), replayCandidates);
  writeJsonl(path.join(EICU_OUTPUT, 'privsearch_corpus.jsonl'), eicuCorpus);

  writeJsonl(path.join(MEDCD_OUTPUT, 'search_notes.jsonl'), medcdNotes);
  writeCsv(path.join(MEDCD_OUTPUT, 'search_queries.csv'), medcdQueries, ['query_id', 'query_text']);
  writeJsonl(path.join(OPENFDA_OUTPUT, 'enforcement_records.jsonl'), openfda.enforcementDocs);
  writeJsonl(path.join(OPENFDA_OUTPUT, 'ndc_records.jsonl'), openfda.ndcDocs);
  writeJsonl(path.join(OPENFDA_OUTPUT, 'recall_product_records.jsonl'), openfda.recallProductDocs);
  writeJsonl(path.join(OPENFDA_OUTPUT, 'privsearch_corpus.jsonl'), openfda.corpus);

  writeJsonl(path.join(COMBINED_OUTPUT, 'healthcare_privsearch_corpus.jsonl'), combinedCorpus);

  const summary = {
    generated_at: new Date().toISOString(),
    inputs: {
      eicu_root: EICU_ROOT,
      medcd_root: MEDCD_ROOT,
      openfda_root: OPENFDA_ROOT,
    },
    eicu: {
      output_root: path.relative(ROOT, EICU_OUTPUT),
      patients: patients.length,
      diagnosis_records: diagnosisRecords.length,
      medication_records: medicationRecords.length,
      replay_event_candidates: replayCandidates.length,
      corpus_documents: eicuCorpus.length,
    },
    medcd: {
      output_root: path.relative(ROOT, MEDCD_OUTPUT),
      notes: medcdNotes.length,
      queries: medcdQueries.length,
    },
    openfda: {
      output_root: path.relative(ROOT, OPENFDA_OUTPUT),
      enforcement_records: openfda.enforcementDocs.length,
      ndc_records: openfda.ndcDocs.length,
      recall_product_records: openfda.recallProductDocs.length,
      corpus_documents: openfda.corpus.length,
    },
    combined: {
      output_root: path.relative(ROOT, COMBINED_OUTPUT),
      total_documents: combinedCorpus.length,
    },
  };

  writeJson(path.join(OUTPUT_ROOT, 'healthcare_dataset_summary.json'), summary);
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'healthcare_dataset_summary.md'), `${buildSummary(summary)}\n`, 'utf8');

  console.log(`Prepared healthcare datasets in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-healthcare-datasets failed:', error);
  process.exitCode = 1;
});
