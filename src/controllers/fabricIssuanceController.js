import { FabricIssuance, DyeingMaterial, Material, Issue, JobOrder, sequelize } from '../models/index.js';
import { addAuditLog } from './materialController.js';
import { getSheetDataCsvText, parseCsvTextIntoRows } from './sheetsController.js';

// 1. GET ALL ISSUED BARCODES
export const allIssuedBarcodes = async (req, res) => {
  try {
    // Get issued rolls from DyeingMaterial
    const dyeingRolls = await DyeingMaterial.findAll({
      where: { status: 'issued' },
      attributes: ['barcodeId']
    });
    const barcodeSet = new Set(dyeingRolls.map(r => r.barcodeId));

    // Get issued barcodes from FabricIssuance records
    const issuances = await FabricIssuance.findAll({
      attributes: ['barcodeIds']
    });

    for (const fs of issuances) {
      if (fs.barcodeIds) {
        try {
          const ids = JSON.parse(fs.barcodeIds);
          if (Array.isArray(ids)) {
            ids.forEach(id => barcodeSet.add(id));
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    res.json({
      success: true,
      data: Array.from(barcodeSet)
    });
  } catch (error) {
    console.error('Error in allIssuedBarcodes:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. STORE FABRIC ISSUANCE
export const storeFabricIssuance = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const {
      lotNumber,
      jobOrderNo,
      fabric,
      brand,
      issuedItems,
      totalQuantity,
      totalWeight,
      issuedBy,
      department,
      issuedAt,
      barcodeIds,
      remarks,
      jobDetails
    } = req.body;

    const issuanceId = `ISS-FAB-${Date.now()}`;

    // Create FabricIssuance record
    const issuance = await FabricIssuance.create({
      issuanceId,
      lotNumber: String(lotNumber),
      jobOrderNo: String(jobOrderNo || ''),
      fabric: String(fabric || ''),
      brand: String(brand || ''),
      totalQuantity: parseInt(totalQuantity) || 0,
      totalWeight: parseFloat(totalWeight) || 0.00,
      issuedBy: String(issuedBy || 'System'),
      department: String(department || 'Production'),
      issuedAt: String(issuedAt || new Date().toISOString()),
      status: 'completed',
      barcodeIds: JSON.stringify(barcodeIds || []),
      issuedItems: JSON.stringify(issuedItems || []),
      remarks: remarks || ''
    }, { transaction });

    // Store/Upsert JobOrder details if provided
    if (jobDetails) {
      await JobOrder.upsert({
        jobOrderNo: jobDetails['Job Order No'] || jobDetails.jobOrderNo || String(jobOrderNo || ''),
        lotNumber: jobDetails['Lot Number'] || jobDetails.lotNumber || String(lotNumber),
        fabric: jobDetails['Fabric'] || jobDetails.fabric || String(fabric || ''),
        brand: jobDetails['Brand'] || jobDetails.brand || String(brand || ''),
        quantity: parseInt(jobDetails['Quantity'] || jobDetails.quantity) || 0,
        unit: jobDetails['Unit'] || jobDetails.unit || '',
        shade: jobDetails['Shade'] || jobDetails.shade || '',
        date: jobDetails['Date'] || jobDetails.date || '',
        size: jobDetails['Size'] || jobDetails.size || '',
        garmentType: jobDetails['Garment Type'] || jobDetails.garmentType || '',
        section: jobDetails['Section'] || jobDetails.section || '',
        season: jobDetails['Season'] || jobDetails.season || '',
        pattern: jobDetails['Pattern'] || jobDetails.pattern || '',
        style: jobDetails['Style'] || jobDetails.style || ''
      }, { transaction });
    }

    // Update statuses of rolls in DyeingMaterial and Material to 'issued' and create Issue records
    if (Array.isArray(barcodeIds) && barcodeIds.length > 0) {
      await DyeingMaterial.update(
        { status: 'issued' },
        {
          where: { barcodeId: barcodeIds },
          transaction
        }
      );

      // Decrement inventory rolls and create entries in the main Issue table
      for (const barcode of barcodeIds) {
        const material = await Material.findOne({
          where: { code: barcode },
          transaction
        });

        if (material) {
          await material.update({
            status: 'issued',
            rolls: Math.max(0, material.rolls - 1),
            stockKg: Math.max(0.00, parseFloat(material.stockKg) - (parseFloat(material.weight) || 0.00))
          }, { transaction });

          const issueCount = await Issue.count({ transaction });
          const issueNo = `ISS-${new Date().getFullYear()}-${String(issueCount + 1).padStart(3, '0')}`;

          await Issue.create({
            issueNo,
            materialId: material.id,
            rolls: 1,
            department: department || 'Production',
            issuedBy: issuedBy || 'System',
            date: issuedAt ? issuedAt.split('T')[0] : new Date().toISOString().split('T')[0],
            reason: remarks || 'Issued via Barcode Scanner',
            status: 'Completed'
          }, { transaction });
        }
      }
    }

    // Add Audit Log
    await addAuditLog(
      'Material Issued',
      `Fabric Lot ${lotNumber}: Issued ${totalQuantity} roll(s) (${parseFloat(totalWeight).toFixed(2)} kg) to ${department}. Job Order: ${jobOrderNo}`,
      issuedBy || 'System',
      'issue'
    );

    await transaction.commit();

    res.json({
      success: true,
      data: {
        id: issuance.id,
        issuanceId
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error storing fabric issuance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. GET ISSUANCE HISTORY PAGINATED
export const issuanceHistory = async (req, res) => {
  try {
    const { lotNumber } = req.params;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    if (!lotNumber) {
      return res.status(400).json({ success: false, message: 'Lot Number is required' });
    }

    // Get count and rows
    const { count, rows } = await FabricIssuance.findAndCountAll({
      where: { lotNumber: String(lotNumber) },
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: offset
    });

    // Parse JSON fields
    const parsedRows = rows.map(row => {
      const data = row.get({ plain: true });
      try {
        data.barcodeIds = JSON.parse(data.barcodeIds || '[]');
      } catch (e) {
        data.barcodeIds = [];
      }
      try {
        data.issuedItems = JSON.parse(data.issuedItems || '[]');
        data.items = data.issuedItems; // compatibility alias
      } catch (e) {
        data.issuedItems = [];
        data.items = [];
      }
      return data;
    });

    res.json({
      success: true,
      data: parsedRows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / pageSize),
        totalRows: count,
        hasNextPage: page * pageSize < count
      }
    });
  } catch (error) {
    console.error('Error in issuanceHistory:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. SYNC OFFLINE DATA
export const syncOfflineData = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { offlineData, dataType } = req.body;
    if (dataType !== 'issuance' || !Array.isArray(offlineData)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid data type or offline payload' });
    }

    for (const record of offlineData) {
      const {
        lotNumber,
        jobOrderNo,
        fabric,
        brand,
        issuedItems,
        totalQuantity,
        totalWeight,
        issuedBy,
        department,
        issuedAt,
        barcodeIds,
        remarks,
        offlineSavedAt,
        jobDetails
      } = record;

      const issuanceId = `ISS-FAB-OFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      await FabricIssuance.create({
        issuanceId,
        lotNumber: String(lotNumber),
        jobOrderNo: String(jobOrderNo || ''),
        fabric: String(fabric || ''),
        brand: String(brand || ''),
        totalQuantity: parseInt(totalQuantity) || 0,
        totalWeight: parseFloat(totalWeight) || 0.00,
        issuedBy: String(issuedBy || 'System'),
        department: String(department || 'Production'),
        issuedAt: String(issuedAt || new Date().toISOString()),
        status: 'completed',
        barcodeIds: JSON.stringify(barcodeIds || []),
        issuedItems: JSON.stringify(issuedItems || []),
        remarks: remarks || '',
        offlineSavedAt: offlineSavedAt || ''
      }, { transaction });

      if (jobDetails) {
        await JobOrder.upsert({
          jobOrderNo: jobDetails['Job Order No'] || jobDetails.jobOrderNo || String(jobOrderNo || ''),
          lotNumber: jobDetails['Lot Number'] || jobDetails.lotNumber || String(lotNumber),
          fabric: jobDetails['Fabric'] || jobDetails.fabric || String(fabric || ''),
          brand: jobDetails['Brand'] || jobDetails.brand || String(brand || ''),
          quantity: parseInt(jobDetails['Quantity'] || jobDetails.quantity) || 0,
          unit: jobDetails['Unit'] || jobDetails.unit || '',
          shade: jobDetails['Shade'] || jobDetails.shade || '',
          date: jobDetails['Date'] || jobDetails.date || '',
          size: jobDetails['Size'] || jobDetails.size || '',
          garmentType: jobDetails['Garment Type'] || jobDetails.garmentType || '',
          section: jobDetails['Section'] || jobDetails.section || '',
          season: jobDetails['Season'] || jobDetails.season || '',
          pattern: jobDetails['Pattern'] || jobDetails.pattern || '',
          style: jobDetails['Style'] || jobDetails.style || ''
        }, { transaction });
      }

      if (Array.isArray(barcodeIds) && barcodeIds.length > 0) {
        await DyeingMaterial.update(
          { status: 'issued' },
          {
            where: { barcodeId: barcodeIds },
            transaction
          }
        );

        for (const barcode of barcodeIds) {
          const material = await Material.findOne({
            where: { code: barcode },
            transaction
          });

          if (material) {
            await material.update({
              status: 'issued',
              rolls: Math.max(0, material.rolls - 1),
              stockKg: Math.max(0.00, parseFloat(material.stockKg) - (parseFloat(material.weight) || 0.00))
            }, { transaction });

            const issueCount = await Issue.count({ transaction });
            const issueNo = `ISS-${new Date().getFullYear()}-${String(issueCount + 1).padStart(3, '0')}`;

            await Issue.create({
              issueNo,
              materialId: material.id,
              rolls: 1,
              department: department || 'Production',
              issuedBy: issuedBy || 'System',
              date: issuedAt ? issuedAt.split('T')[0] : new Date().toISOString().split('T')[0],
              reason: remarks || 'Issued via Barcode Scanner',
              status: 'Completed'
            }, { transaction });
          }
        }
      }

      await addAuditLog(
        'Material Issued',
        `[Offline Synced] Fabric Lot ${lotNumber}: Issued ${totalQuantity} roll(s) (${parseFloat(totalWeight).toFixed(2)} kg) to ${department}`,
        issuedBy || 'System',
        'issue'
      );
    }

    await transaction.commit();
    res.json({ success: true });
  } catch (error) {
    await transaction.rollback();
    console.error('Error syncing offline data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const parseSheetDateToYmd = (dateStr) => {
  if (!dateStr || dateStr === '—') return '';
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

  // Try fallback to standard Date parsing if possible
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) { }

  return dateStr;
};

// 5. GET DYEING DISCREPANCY REPORT
export const getDyeingDiscrepancyReport = async (req, res) => {
  try {
    // 1. Fetch Google Sheet CSV data (Sent)
    const sheetRows = [];
    try {
      const csvText = await getSheetDataCsvText();
      const rows = parseCsvTextIntoRows(csvText);

      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 4) continue;
        const billNo = String(row[3]).trim(); // Issue No (Bill Number)
        if (!billNo) continue;

        sheetRows.push({
          brand: row[0] || '—',       // Party
          fabric: row[1] || '—',      // Fabric Name
          lotNumber: String(row[2] || '—').trim(),   // Lot Number
          billNumber: billNo,
          date: parseSheetDateToYmd(row[4] || '—'),
          shade: row[5] || '—',       // Shade (Color)
          sentWeight: parseFloat(row[8]) || 0.00,
          sentRolls: parseInt(row[14]) || 0
        });
      }
    } catch (sheetError) {
      console.error('[Discrepancy Report] Error fetching/parsing Google Sheets:', sheetError);
    }

    // 2. Group received entries in MySQL DyeingMaterial by billNumber
    const receivedSummaries = await DyeingMaterial.findAll({
      attributes: [
        'billNumber',
        'lotNumber',
        'cmfName',
        'fabricName',
        'shade',
        [sequelize.fn('COUNT', sequelize.col('id')), 'receivedRolls'],
        [sequelize.fn('SUM', sequelize.col('weight')), 'receivedWeight'],
        [sequelize.fn('MAX', sequelize.col('batchNumber')), 'batchNumber'],
        [sequelize.fn('MAX', sequelize.col('createdAt')), 'latestReceivedAt'],
        [sequelize.fn('MAX', sequelize.col('location')), 'location'],
        [sequelize.fn('GROUP_CONCAT', sequelize.col('barcodeId')), 'barcodeIds']
      ],
      group: ['billNumber', 'lotNumber', 'cmfName', 'fabricName', 'shade'],
      raw: true
    });

    // 3. Fetch all local FabricIssuances and JobOrders as fallbacks
    const issuances = await FabricIssuance.findAll({ raw: true });
    const issuanceMap = new Map();
    issuances.forEach(iss => {
      if (iss.lotNumber) issuanceMap.set(String(iss.lotNumber).toLowerCase(), iss);
      if (iss.issuanceId) issuanceMap.set(String(iss.issuanceId).toLowerCase(), iss);
    });

    const jobOrders = await JobOrder.findAll({ raw: true });
    const jobOrderMap = new Map();
    jobOrders.forEach(jo => {
      if (jo.lotNumber) jobOrderMap.set(String(jo.lotNumber).toLowerCase(), jo);
      if (jo.jobOrderNo) jobOrderMap.set(String(jo.jobOrderNo).toLowerCase(), jo);
    });

    // 4. Helper for color comparison
    const checkColorMatch = (sentShade, receivedShade) => {
      if (!sentShade || !receivedShade) return true; // Default to true if missing
      const normSent = String(sentShade).toLowerCase().replace(/[^a-z0-9]/g, '');
      const normRec = String(receivedShade).toLowerCase().replace(/[^a-z0-9]/g, '');
      return normRec.includes(normSent) || normSent.includes(normRec);
    };

    // 5. Merge and validate by Bill Number / Lot Number combination
    const reportData = receivedSummaries.map(summary => {
      const billNo = String(summary.billNumber || '').trim();
      const lot = String(summary.lotNumber || '').trim();
      const fabric = String(summary.fabricName || '').trim();

      // Find the best match from sheetRows
      let matchedData = null;

      // Match 1: Exact bill, lot, and fabric name (case-insensitive)
      if (billNo && lot && fabric) {
        matchedData = sheetRows.find(row =>
          row.billNumber.toLowerCase() === billNo.toLowerCase() &&
          row.lotNumber.toLowerCase() === lot.toLowerCase() &&
          row.fabric.toLowerCase() === fabric.toLowerCase()
        );
      }

      // Match 2: Exact bill and lot (case-insensitive)
      if (!matchedData && billNo && lot) {
        matchedData = sheetRows.find(row =>
          row.billNumber.toLowerCase() === billNo.toLowerCase() &&
          row.lotNumber.toLowerCase() === lot.toLowerCase()
        );
      }

      // Match 3: Exact lot number (case-insensitive)
      if (!matchedData && lot) {
        matchedData = sheetRows.find(row =>
          row.lotNumber.toLowerCase() === lot.toLowerCase()
        );
      }

      // Match 4: Exact bill number (case-insensitive)
      if (!matchedData && billNo) {
        matchedData = sheetRows.find(row =>
          row.billNumber.toLowerCase() === billNo.toLowerCase()
        );
      }

      // Local fallbacks if still not matched from sheets
      const iss = issuanceMap.get(lot.toLowerCase()) || (billNo ? issuanceMap.get(billNo.toLowerCase()) : null);
      const jo = jobOrderMap.get(lot.toLowerCase()) || (billNo ? jobOrderMap.get(billNo.toLowerCase()) : null);

      // Sent Values
      const sentRolls = matchedData ? matchedData.sentRolls : (iss ? parseInt(iss.totalQuantity) : (jo ? parseInt(jo.quantity) : 0));
      const sentWeight = matchedData ? matchedData.sentWeight : (iss ? parseFloat(iss.totalWeight) : 0.00);
      const sentShade = matchedData ? matchedData.shade : (jo ? jo.shade : (iss ? iss.remarks : '—')); // fallback to remarks or job order shade
      const date = matchedData ? matchedData.date : (jo ? parseSheetDateToYmd(jo.date) : (iss ? (iss.issuedAt ? iss.issuedAt.split('T')[0] : '') : ''));

      // Received Values
      const recRolls = parseInt(summary.receivedRolls) || 0;
      const recWeight = parseFloat(summary.receivedWeight) || 0.00;
      const recShade = summary.shade || '—';

      // Differences
      const rollDiff = sentRolls - recRolls;
      const weightDiff = sentWeight - recWeight;

      // Shortage calculation
      let shortagePct = 0;
      if (sentWeight > 0) {
        shortagePct = (weightDiff / sentWeight) * 100;
      }

      // Validation flags
      const shortageAlert = shortagePct > 10;
      const rollCountAlert = recRolls < sentRolls;
      const colorMismatch = !checkColorMatch(sentShade, recShade);

      // Determine verification status
      let status = 'OK';
      if (shortageAlert) {
        status = 'Shortage Alert';
      } else if (rollCountAlert) {
        status = 'Fewer Rolls Alert';
      } else if (colorMismatch) {
        status = 'Color Mismatch';
      }

      return {
        billNumber: billNo || '—',
        lotNumber: lot || '—',
        batchNumber: summary.batchNumber || '—',
        fabric: matchedData ? matchedData.fabric : (iss ? iss.fabric : (jo ? jo.fabric : summary.fabricName || '—')),
        brand: matchedData ? matchedData.brand : (iss ? iss.brand : (jo ? jo.brand : summary.cmfName || '—')),
        sentRolls,
        sentWeight: parseFloat(sentWeight.toFixed(2)),
        receivedRolls: recRolls,
        receivedWeight: parseFloat(recWeight.toFixed(2)),
        rollDiff,
        weightDiff: parseFloat(weightDiff.toFixed(2)),
        shortagePct: parseFloat(shortagePct.toFixed(1)),
        sentShade: sentShade || '—',
        receivedShade: recShade || '—',
        shortageAlert,
        rollCountAlert,
        colorMismatch,
        status,
        latestReceivedAt: summary.latestReceivedAt,
        location: summary.location || '—',
        date: (date && date !== '—') ? date : '',
        barcodeIds: summary.barcodeIds || ''
      };
    });

    res.json({
      success: true,
      data: reportData
    });
  } catch (error) {
    console.error('Error generating dyeing discrepancy report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

