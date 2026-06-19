import { Material, Room, DyeingMaterial, JobOrder, sequelize } from '../models/index.js';
import { addAuditLog, checkShelfCapacity, getNextBarcodeId } from './materialController.js';
import { Op } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '../cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const SHEET_DATA_CACHE_PATH = path.join(CACHE_DIR, 'sheet_data.csv');
const JOB_ORDERS_CACHE_PATH = path.join(CACHE_DIR, 'job_orders.csv');

const getDefaultJobOrdersCsv = () => {
  return [
    'Job Order No,Lot Number,Fabric,Brand,Quantity,Unit,Shade,Date,Size,Garment Type,Section,Season,Pattern,Style',
    'JO-2026-001,76038,Premium Cotton Dyeing Fabric,Levi\'s,500,Pcs,Royal Blue,2026-03-27,M,T-Shirt,Sewing,Summer 2026,Solid,Classic',
    'JO-2026-002,DY-LOT-001,Cotton Dyeing Fabric,Gap,300,Pcs,Navy Blue,2026-04-17,L,Polo,Sewing,Summer 2026,Striped,Fit',
    'JO-2026-003,1001,Super Soft Cotton,Uniqlo,400,Pcs,Jet Black,2026-04-28,XL,Hoodie,Stitching,Winter 2026,Solid,Oversized',
    'JO-2026-004,1002,Pure Linen Fabric,Zara,600,Pcs,Off White,2026-05-02,S,Shirt,Sewing,Spring 2026,Solid,Casual',
    'JO-2026-005,1003,Performance Polyester,Nike,200,Pcs,Crimson Red,2026-05-10,M,Shorts,Stitching,Summer 2026,Solid,Athletic'
  ].join('\n');
};

const getDefaultSheetDataCsv = () => {
  return [
    'Party,Fabric Name,Lot Number,Issue No,Issue Date,Shade,Col6,Col7,Weight,Col9,Col10,Col11,Col12,Col13,Total Rolls',
    'Cotton CMF-76038,Premium Cotton Dyeing Fabric,76038,BILL-76038,27-Mar-26,Royal Blue,,,120.00,,,,,,5',
    'Dyeing CMF,Cotton Dyeing Fabric,DY-LOT-001,DY-BILL-001,17-Apr-26,Navy Blue,,,85.50,,,,,,3',
    'Super Soft Corp,Super Soft Cotton,1001,BILL-1001,28-Apr-26,Jet Black,,,150.25,,,,,,4',
    'Linen House,Pure Linen Fabric,1002,BILL-1002,02-May-26,Off White,,,210.00,,,,,,6',
    'Polyester Co,Performance Polyester,1003,BILL-1003,10-May-26,Crimson Red,,,95.00,,,,,,2'
  ].join('\n');
};

export const nextBarcodeId = async (req, res) => {
  try {
    const barcodeData = await getNextBarcodeId();
    res.json({
      success: true,
      data: barcodeData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const storeFabricData = async (req, res) => {
  try {
    const {
      barcodeId,
      cmfName,
      fabricName,
      shade,
      lotNumber,
      group,
      billNumber,
      date,
      location,
      receivedPerson,
      authorizedPerson,
      weight,
      rollNumber,
      batchTotal
    } = req.body;

    // Determine category based on room if possible, else default to 'Summer Fabric'
    let category = 'Summer Fabric';

    // Find or create material
    const material = await Material.create({
      code: barcodeId,
      name: fabricName || cmfName || 'Dyeing Fabric',
      category: category,
      subCategory: group || '',
      color: shade || '',
      supplier: null, // default
      weight: parseFloat(weight) || 0.00,
      rolls: 1, // single roll per barcode
      unit: 'Roll',
      location: location || null,
      status: 'Active',
      stockKg: parseFloat(weight) || 0.00,
      billNumber: billNumber || '',
      receivedPerson: receivedPerson || '',
      authorizedPerson: authorizedPerson || '',
      receivedDate: date || new Date().toISOString().slice(0, 10)
    });

    await addAuditLog(
      'Material Received',
      `Roll ${rollNumber}/${batchTotal} of Lot ${lotNumber} received with barcode ${barcodeId} at shelf ${location}`,
      receivedPerson || 'System',
      'receive'
    );

    res.json({
      success: true,
      data: material
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const storeDyeingData = async (req, res) => {
  try {
    const {
      barcodeId,
      cmfName,
      fabricName,
      shade,
      lotNumber,
      group,
      billNumber,
      date,
      location,
      receivedPerson,
      authorizedPerson,
      weight,
      rollNumber,
      batchTotal,
      batchNumber,
      batchDate,
      batchTime,
      timestamp,
      generatedAt
    } = req.body;

    const rollsVal = 1;
    await checkShelfCapacity(location, rollsVal);

    const dyeingMaterial = await DyeingMaterial.create({
      barcodeId: barcodeId,
      batchNumber: batchNumber || '',
      batchDate: batchDate || '',
      batchTime: batchTime || '',
      cmfName: cmfName || '',
      fabricName: fabricName || 'Dyeing Fabric',
      lotNumber: lotNumber || '',
      group: group || '',
      shade: shade || '',
      billNumber: billNumber || '',
      date: date || new Date().toISOString().slice(0, 10),
      location: location || null,
      receivedPerson: receivedPerson || '',
      authorizedPerson: authorizedPerson || '',
      rollNumber: parseInt(rollNumber) || 1,
      batchTotal: parseInt(batchTotal) || 1,
      batchStatus: 'completed',
      weight: parseFloat(weight) || 0.00,
      generatedAt: generatedAt || new Date().toLocaleTimeString(),
      timestamp: timestamp || new Date().toISOString(),
      status: 'in_stock'
    });

    // Write to dyeing_materials.json backup file for cross check
    const cacheFilePath = path.join(CACHE_DIR, 'dyeing_materials.json');
    let fileList = [];
    try {
      if (fs.existsSync(cacheFilePath)) {
        const fileContent = fs.readFileSync(cacheFilePath, 'utf8');
        if (fileContent.trim()) {
          fileList = JSON.parse(fileContent);
        }
      }
    } catch (fileReadError) {
      console.error('[Sheets API] Error reading dyeing_materials.json file:', fileReadError);
    }

    const newFileRecord = {
      barcodeId: barcodeId,
      batchNumber: batchNumber || '',
      batchDate: batchDate || '',
      batchTime: batchTime || '',
      cmfName: cmfName || '',
      fabricName: fabricName || 'Dyeing Fabric',
      lotNumber: lotNumber || '',
      group: group || '',
      shade: shade || '',
      billNumber: billNumber || '',
      date: date || new Date().toISOString().slice(0, 10),
      location: location || null,
      receivedPerson: receivedPerson || '',
      authorizedPerson: authorizedPerson || '',
      rollNumber: parseInt(rollNumber) || 1,
      batchTotal: parseInt(batchTotal) || 1,
      batchStatus: 'completed',
      weight: parseFloat(weight) || 0.00,
      generatedAt: generatedAt || new Date().toLocaleTimeString(),
      timestamp: timestamp || new Date().toISOString(),
      status: 'in_stock'
    };

    const existingIndex = fileList.findIndex(item => item.barcodeId === barcodeId);
    if (existingIndex >= 0) {
      fileList[existingIndex] = newFileRecord;
    } else {
      fileList.push(newFileRecord);
    }

    try {
      fs.writeFileSync(cacheFilePath, JSON.stringify(fileList, null, 2), 'utf8');
      console.log(`[Sheets API] Saved roll ${barcodeId} to dyeing_materials.json`);
    } catch (fileWriteError) {
      console.error('[Sheets API] Error writing to dyeing_materials.json file:', fileWriteError);
    }

    await addAuditLog(
      'Material Received',
      `Roll ${rollNumber}/${batchTotal} of Lot ${lotNumber} received with barcode ${barcodeId} at shelf ${location} (Dyeing)`,
      receivedPerson || 'System',
      'receive'
    );

    res.json({
      success: true,
      data: dyeingMaterial
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const completeBatch = async (req, res) => {
  try {
    const {
      batchNumber,
      lotNumber,
      totalRolls,
      processedRolls,
      completedBy,
      message
    } = req.body;

    const detailText = message || `Batch ${batchNumber} (${lotNumber || 'N/A'}): processed ${processedRolls} of ${totalRolls} rolls.`;

    await addAuditLog(
      'Batch Completed',
      detailText,
      completedBy || 'System',
      'receive'
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const fetchDyeingLotDetails = async (req, res) => {
  try {
    const { lotNumber } = req.query;
    if (!lotNumber) {
      return res.status(400).json({ success: false, message: 'lotNumber is required' });
    }

    // Try to lookup from database first (query DyeingMaterial table by lotNumber or barcodeId)
    const existing = await DyeingMaterial.findOne({
      where: {
        [Op.or]: [
          { barcodeId: lotNumber },
          { lotNumber: lotNumber }
        ]
      }
    });

    if (existing) {
      // Split shade into issued and received if combined
      let issuedShade = existing.shade || 'Sky Blue';
      let receivedShade = '';
      if (issuedShade.includes(' / ')) {
        const parts = issuedShade.split(' / ');
        issuedShade = parts[0];
        receivedShade = parts[1];
      }

      return res.json({
        success: true,
        data: {
          cmfName: existing.cmfName,
          fabricName: existing.fabricName,
          group: existing.group,
          issuedShade: issuedShade,
          receivedShade: receivedShade,
          billNumber: existing.billNumber || '',
          date: existing.date,
          receivedPerson: existing.receivedPerson || '',
          authorizedPerson: existing.authorizedPerson || '',
          totalRolls: existing.batchTotal || 1
        }
      });
    }

    // Try to lookup from JobOrder database table next
    const job = await JobOrder.findOne({
      where: { lotNumber: String(lotNumber).trim() }
    });

    if (job) {
      return res.json({
        success: true,
        data: {
          cmfName: job.brand || '',
          fabricName: job.fabric || '',
          group: job.fabric || '',
          issuedShade: job.shade || '',
          receivedShade: '',
          billNumber: '',
          date: job.date || '',
          receivedPerson: '',
          authorizedPerson: '',
          totalRolls: job.quantity || 1,
          shade: job.shade || ''
        }
      });
    }

    // Helper to parse '27-Mar-26' into '2026-03-27'
    const parseSheetDateToYmd = (dateStr) => {
      if (!dateStr) return '';
      const months = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      };
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1].toLowerCase()] || '01';
        let year = parts[2];
        if (year.length === 2) year = '20' + year;
        return `${year}-${month}-${day}`;
      }
      return dateStr;
    };

    // Fallback: search in the main Sheet CSV (CMF sheet)
    try {
      const csvText = await getSheetDataCsvText();
      const rows = parseCsvTextIntoRows(csvText);
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue;
        const sheetLot = String(row[2]).trim();
        if (sheetLot.toLowerCase() === String(lotNumber).trim().toLowerCase()) {
          console.log(`[Dyeing Lot Lookup] Found Lot ${lotNumber} in CMF Google Sheet CSV fallback`);
          return res.json({
            success: true,
            data: {
              cmfName: row[0] || '—',
              fabricName: row[1] || '—',
              group: row[1] || '—',
              issuedShade: row[5] || '—',
              receivedShade: row[6] || '',
              billNumber: row[3] || '—',
              date: parseSheetDateToYmd(row[4]),
              receivedPerson: '',
              authorizedPerson: '',
              totalRolls: parseInt(row[15]) || 1
            }
          });
        }
      }
    } catch (csvErr) {
      console.error('Error searching lot in CSV fallback:', csvErr);
    }

    return res.status(404).json({ success: false, message: 'Lot Number not found in database or sheet' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// In-memory cache for Google Sheet CSV data
let cachedCsvText = null;
let cacheTimestamp = 0;
let cachedJobOrdersCsvText = null;
let jobOrdersCacheTimestamp = 0;
const CACHE_TTL_MS = 15000; // 15 seconds TTL

export const getSheetDataCsvText = async () => {
  const now = Date.now();
  if (cachedCsvText && (now - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedCsvText;
  }

  try {
    console.log('[Sheets API] Fetching fresh CSV from Google Sheets...');
    const response = await fetch('https://docs.google.com/spreadsheets/d/1xvafKcozZqf9yeWoLil4Eaws9A0j7WDz1zpxItKfr1c/export?format=csv');
    if (!response.ok) {
      throw new Error(`Failed to fetch from Google Sheets: ${response.status}`);
    }
    const csvText = await response.text();
    cachedCsvText = csvText;
    cacheTimestamp = now;
    // Save to disk cache asynchronously
    fs.promises.writeFile(SHEET_DATA_CACHE_PATH, csvText, 'utf8').catch(err => {
      console.error('[Sheets API] Error saving Sheet Data to disk cache:', err);
    });
    return csvText;
  } catch (fetchErr) {
    console.warn('[Sheets API] Offline/Network error fetching Sheet Data. Falling back to cache...', fetchErr.message);
    if (fs.existsSync(SHEET_DATA_CACHE_PATH)) {
      const csvText = fs.readFileSync(SHEET_DATA_CACHE_PATH, 'utf8');
      cachedCsvText = csvText;
      cacheTimestamp = now;
      return csvText;
    } else {
      console.log('[Sheets API] No disk cache found for Sheet Data. Seeding mock data.');
      const seedData = getDefaultSheetDataCsv();
      try {
        fs.writeFileSync(SHEET_DATA_CACHE_PATH, seedData, 'utf8');
      } catch (writeErr) {
        console.error('[Sheets API] Failed to seed mock Sheet Data CSV:', writeErr);
      }
      cachedCsvText = seedData;
      cacheTimestamp = now;
      return seedData;
    }
  }
};

const getJobOrdersCsvText = async () => {
  const now = Date.now();
  if (cachedJobOrdersCsvText && (now - jobOrdersCacheTimestamp < CACHE_TTL_MS)) {
    return cachedJobOrdersCsvText;
  }

  try {
    console.log('[Sheets API] Fetching fresh Job Orders CSV from Google Sheets...');
    const response = await fetch('https://docs.google.com/spreadsheets/d/13ArpFOD7idmpv7QIRJQkD-tfswtkH6rNnEANtv2M7Ek/export?format=csv&gid=0');
    if (!response.ok) {
      throw new Error(`Failed to fetch Job Orders from Google Sheets: ${response.status}`);
    }
    const csvText = await response.text();
    cachedJobOrdersCsvText = csvText;
    jobOrdersCacheTimestamp = now;
    // Save to disk cache asynchronously
    fs.promises.writeFile(JOB_ORDERS_CACHE_PATH, csvText, 'utf8').catch(err => {
      console.error('[Sheets API] Error saving Job Orders to disk cache:', err);
    });
    return csvText;
  } catch (fetchErr) {
    console.warn('[Sheets API] Offline/Network error fetching Job Orders. Falling back to cache...', fetchErr.message);
    if (fs.existsSync(JOB_ORDERS_CACHE_PATH)) {
      const csvText = fs.readFileSync(JOB_ORDERS_CACHE_PATH, 'utf8');
      cachedJobOrdersCsvText = csvText;
      jobOrdersCacheTimestamp = now;
      return csvText;
    } else {
      console.log('[Sheets API] No disk cache found for Job Orders. Seeding mock data.');
      const seedData = getDefaultJobOrdersCsv();
      try {
        fs.writeFileSync(JOB_ORDERS_CACHE_PATH, seedData, 'utf8');
      } catch (writeErr) {
        console.error('[Sheets API] Failed to seed mock Job Orders CSV:', writeErr);
      }
      cachedJobOrdersCsvText = seedData;
      jobOrdersCacheTimestamp = now;
      return seedData;
    }
  }
};

const parseSheetDate = (dateStr) => {
  if (!dateStr) return new Date().toISOString().split('T')[0];

  // Try parsing DD-Mmm-YY, e.g. 27-Mar-26 or 17-Apr-26
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    let day = parseInt(parts[0], 10);
    let monthName = parts[1].toLowerCase();
    let year = parseInt(parts[2], 10);

    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };

    let month = null;
    for (const [key, val] of Object.entries(months)) {
      if (monthName.startsWith(key)) {
        month = val;
        break;
      }
    }

    if (month && !isNaN(day) && !isNaN(year)) {
      if (year < 100) {
        year = 2000 + year;
      }
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${month}-${dayStr}`;
    }
  }

  // Fallback to standard parsing
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) { }

  return new Date().toISOString().split('T')[0];
};

// CSV Line parser helper
const parseCsvLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

// Robust CSV text parser that handles quoted newlines correctly
export const parseCsvTextIntoRows = (csvText) => {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF
      }
      currentRow.push(currentField.trim());
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows;
};

export const fetchSheetDataByLot = async (req, res) => {
  try {
    const { lotNo } = req.params;
    if (!lotNo) {
      return res.status(400).json({ success: false, message: 'Lot Number is required' });
    }

    console.log(`[Sheet Data By Lot] Searching database for Lot: ${lotNo}`);

    // Check DyeingMaterial table first
    const existing = await DyeingMaterial.findOne({
      where: {
        [Op.or]: [
          { barcodeId: lotNo },
          { lotNumber: lotNo }
        ]
      }
    });

    if (existing) {
      return res.json({
        success: true,
        data: {
          cmfName: existing.cmfName || '',
          fabricName: existing.fabricName || '',
          group: existing.group || '',
          shade: existing.shade || '',
          lotNumber: existing.lotNumber || '',
          billNumber: existing.billNumber || '',
          date: existing.date || '',
          receivedPerson: existing.receivedPerson || '',
          authorizedPerson: existing.authorizedPerson || '',
          totalRolls: existing.batchTotal || 1,
          weight: existing.weight || 0
        }
      });
    }

    // Check JobOrder table second
    const job = await JobOrder.findOne({
      where: { lotNumber: String(lotNo).trim() }
    });

    if (job) {
      return res.json({
        success: true,
        data: {
          cmfName: job.brand || '',
          fabricName: job.fabric || '',
          group: job.fabric || '',
          shade: job.shade || '',
          lotNumber: job.lotNumber || '',
          billNumber: '',
          date: job.date || '',
          receivedPerson: '',
          authorizedPerson: '',
          totalRolls: job.quantity || 1,
          weight: 0
        }
      });
    }

    return res.status(404).json({ success: false, message: 'Lot Number not found in database' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const fetchJobOrders = async (req, res) => {
  try {
    // 1. Sync from Google Sheets first
    try {
      console.log('[Job Orders Sync] Fetching CSV from Google Sheets...');
      const csvText = await getJobOrdersCsvText();
      const rows = parseCsvTextIntoRows(csvText);

      if (rows && rows.length > 1) {
        const headers = rows[0];

        // Find column indices based on header names
        const getColIdx = (name) => headers.indexOf(name);

        const jobOrderNoIdx = getColIdx('Job Order No');
        const lotNumberIdx = getColIdx('Lot Number');
        const fabricIdx = getColIdx('Fabric');
        const brandIdx = getColIdx('Brand');
        const quantityIdx = getColIdx('Quantity');
        const unitIdx = getColIdx('Unit');
        const shadeIdx = getColIdx('Shade');
        const dateIdx = getColIdx('Date');
        const sizeIdx = getColIdx('Size');
        const garmentTypeIdx = getColIdx('Garment Type');
        const sectionIdx = getColIdx('Section');
        const seasonIdx = getColIdx('Season');
        const patternIdx = getColIdx('Pattern');
        const styleIdx = getColIdx('Style');

        const upsertPromises = [];

        // Skip header row
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2) continue;

          const lotNumber = lotNumberIdx !== -1 ? String(row[lotNumberIdx]).trim() : '';
          if (!lotNumber) continue;

          const jobOrderData = {
            jobOrderNo: jobOrderNoIdx !== -1 ? String(row[jobOrderNoIdx]).trim() : '',
            lotNumber: lotNumber,
            fabric: fabricIdx !== -1 ? String(row[fabricIdx]).trim() : '',
            brand: brandIdx !== -1 ? String(row[brandIdx]).trim() : '',
            quantity: quantityIdx !== -1 ? parseInt(row[quantityIdx], 10) || 0 : 0,
            unit: unitIdx !== -1 ? String(row[unitIdx]).trim() : '',
            shade: shadeIdx !== -1 ? String(row[shadeIdx]).trim() : '',
            date: dateIdx !== -1 ? String(row[dateIdx]).trim() : '',
            size: sizeIdx !== -1 ? String(row[sizeIdx]).trim() : '',
            garmentType: garmentTypeIdx !== -1 ? String(row[garmentTypeIdx]).trim() : '',
            section: sectionIdx !== -1 ? String(row[sectionIdx]).trim() : '',
            season: seasonIdx !== -1 ? String(row[seasonIdx]).trim() : '',
            pattern: patternIdx !== -1 ? String(row[patternIdx]).trim() : '',
            style: styleIdx !== -1 ? String(row[styleIdx]).trim() : ''
          };

          upsertPromises.push(JobOrder.upsert(jobOrderData));
        }

        // Run all upserts
        await Promise.all(upsertPromises);
        console.log(`[Job Orders Sync] Successfully synchronized ${upsertPromises.length} job orders from Google Sheets.`);
      }
    } catch (syncError) {
      console.warn('[Job Orders Sync] Warning: Failed to sync from Google Sheets, serving from DB fallback:', syncError.message);
    }

    // 2. Fetch all from database
    const dbJobs = await JobOrder.findAll({
      order: [['id', 'DESC']]
    });

    const mapped = dbJobs.map(job => ({
      'Job Order No': job.jobOrderNo,
      'Lot Number': job.lotNumber,
      'Fabric': job.fabric,
      'Brand': job.brand,
      'Quantity': job.quantity,
      'Unit': job.unit,
      'Shade': job.shade,
      'Date': job.date,
      'Size': job.size,
      'Garment Type': job.garmentType,
      'Section': job.section,
      'Season': job.season,
      'Pattern': job.pattern,
      'Style': job.style
    }));

    console.log(`[Job Orders API] Loaded ${mapped.length} Job Orders from database.`);
    res.json(mapped);
  } catch (error) {
    console.error('[Job Orders API] Error fetching job orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const fetchInventoryRolls = async (req, res) => {
  try {
    console.log('[Inventory API] Fetching all inventory rolls...');

    // Fetch from Material
    const materials = await Material.findAll();

    // Fetch from DyeingMaterial
    const dyeingMaterials = await DyeingMaterial.findAll();

    const mappedMaterials = materials.map(m => ({
      'Barcode ID': m.code,
      'Item Description': m.name,
      'Shade': m.color,
      'Weight (KG)': parseFloat(m.weight) || 0.00,
      'Status': (m.status || 'Active').toLowerCase() === 'issued' ? 'issued' : 'in_stock',
      'Party': ''
    }));

    const mappedDyeing = dyeingMaterials.map(dm => ({
      'Barcode ID': dm.barcodeId,
      'Item Description': dm.fabricName || dm.cmfName,
      'Shade': dm.shade,
      'Weight (KG)': parseFloat(dm.weight) || 0.00,
      'Status': (dm.status || 'in_stock').toLowerCase() === 'issued' ? 'issued' : 'in_stock',
      'Party': dm.cmfName || ''
    }));

    const allRolls = [...mappedMaterials, ...mappedDyeing];
    console.log(`[Inventory API] Loaded ${allRolls.length} rolls from database`);
    res.json(allRolls);
  } catch (error) {
    console.error('[Inventory API] Error fetching inventory rolls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const searchJobOrderByLot = async (req, res) => {
  try {
    const { lotNumber } = req.params;
    if (!lotNumber) {
      return res.status(400).json({ success: false, message: 'Lot Number is required' });
    }

    console.log(`[Job Order Search] Checking MySQL database for Lot: ${lotNumber}`);
    const dbJob = await JobOrder.findOne({
      where: { lotNumber: String(lotNumber).trim() }
    });

    if (dbJob) {
      console.log(`[Job Order Search] Found Lot ${lotNumber} in MySQL database`);
      // Map back to frontend expected header names
      const mappedData = {
        'Job Order No': dbJob.jobOrderNo,
        'Lot Number': dbJob.lotNumber,
        'Fabric': dbJob.fabric,
        'Brand': dbJob.brand,
        'Quantity': dbJob.quantity,
        'Unit': dbJob.unit,
        'Shade': dbJob.shade,
        'Date': dbJob.date,
        'Size': dbJob.size,
        'Garment Type': dbJob.garmentType,
        'Section': dbJob.section,
        'Season': dbJob.season,
        'Pattern': dbJob.pattern,
        'Style': dbJob.style
      };
      return res.json({
        success: true,
        data: mappedData,
        source: 'database'
      });
    }

    console.log(`[Job Order Search] Lot ${lotNumber} NOT found in MySQL database.`);
    return res.status(404).json({ success: false, message: 'Lot Number not found in database' });
  } catch (error) {
    console.error('[Job Order Search] Error searching job order:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDyeingMaterials = async (req, res) => {
  try {
    const dbMaterials = await DyeingMaterial.findAll({
      order: [['id', 'DESC']]
    });

    const cacheFilePath = path.join(CACHE_DIR, 'dyeing_materials.json');
    let fileMaterials = [];
    try {
      if (fs.existsSync(cacheFilePath)) {
        const fileContent = fs.readFileSync(cacheFilePath, 'utf8');
        if (fileContent.trim()) {
          fileMaterials = JSON.parse(fileContent);
        }
      }
    } catch (fileReadError) {
      console.error('[Sheets API] Error reading dyeing_materials.json:', fileReadError);
    }

    const fileMap = new Map(fileMaterials.map(item => [item.barcodeId, item]));
    const dbBarcodes = new Set();

    // Cross-reference DB with File
    const mappedDbMaterials = dbMaterials.map(dbItem => {
      const dbJson = dbItem.toJSON();
      dbBarcodes.add(dbJson.barcodeId);
      const fileItem = fileMap.get(dbJson.barcodeId);

      let crossCheckStatus = 'missing_in_file';
      if (fileItem) {
        const dbWeight = parseFloat(dbJson.weight) || 0;
        const fileWeight = parseFloat(fileItem.weight) || 0;
        const weightsMatch = Math.abs(dbWeight - fileWeight) < 0.01;
        const lotMatch = String(dbJson.lotNumber) === String(fileItem.lotNumber);

        if (weightsMatch && lotMatch) {
          crossCheckStatus = 'verified';
        } else {
          crossCheckStatus = 'mismatch';
        }
      }

      return {
        ...dbJson,
        crossCheckStatus
      };
    });

    // Find items in file that are missing from database
    const fileOnlyMaterials = fileMaterials
      .filter(fItem => !dbBarcodes.has(fItem.barcodeId))
      .map(fItem => ({
        ...fItem,
        id: `file-${fItem.barcodeId}`,
        crossCheckStatus: 'missing_in_db'
      }));

    // Combine them (DB records first, then file-only records)
    const merged = [...mappedDbMaterials, ...fileOnlyMaterials];

    res.json({
      success: true,
      data: merged
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDyeingMaterialsFile = async (req, res) => {
  try {
    const cacheFilePath = path.join(CACHE_DIR, 'dyeing_materials.json');
    if (fs.existsSync(cacheFilePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=dyeing_materials.json');
      return res.sendFile(cacheFilePath);
    }
    // Return empty array if file does not exist yet
    res.json([]);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


