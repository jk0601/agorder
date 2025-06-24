const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { validateOrderData } = require('../utils/validation');
const { convertToStandardFormat } = require('../utils/converter');

const router = express.Router();

// 업로드 디렉토리 설정 (Render에서는 /tmp 사용)
const uploadsDir = process.env.NODE_ENV === 'production' 
  ? path.join('/tmp', 'uploads')  // Render에서는 /tmp 사용
  : path.join(__dirname, '../uploads');

// 폴더 확인 및 생성
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 업로드 폴더 생성됨:', uploadsDir);
}

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 📁 파일 업로드 및 미리보기
router.post('/upload', upload.single('orderFile'), async (req, res) => {
  try {
    console.log('📁 파일 업로드 요청 수신');
    console.log('📂 업로드 디렉토리:', uploadsDir);
    console.log('🌍 NODE_ENV:', process.env.NODE_ENV);
    
    if (!req.file) {
      console.log('❌ 파일이 업로드되지 않음');
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    console.log('✅ 파일 업로드 성공:', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      path: req.file.path
    });

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    let previewData = [];
    let headers = [];

    if (fileExtension === '.csv') {
      // CSV 파일 처리
      const csvData = fs.readFileSync(filePath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length > 0) {
        headers = lines[0].split(',').map(h => h.trim());
        previewData = lines.slice(1, 21).map(line => {
          const values = line.split(',').map(v => v.trim());
          const rowData = {};
          headers.forEach((header, index) => {
            rowData[header] = values[index] || '';
          });
          return rowData;
        });
      }
    } else {
      // Excel 파일 처리
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.getWorksheet(1);
      
      if (worksheet) {
        const firstRow = worksheet.getRow(1);
        headers = [];
        firstRow.eachCell((cell, colNumber) => {
          headers.push(cell.value ? cell.value.toString() : `컬럼${colNumber}`);
        });

        // 상위 20행까지 미리보기 데이터 생성
        for (let rowNumber = 2; rowNumber <= Math.min(21, worksheet.rowCount); rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          const rowData = {};
          
          headers.forEach((header, index) => {
            const cell = row.getCell(index + 1);
            rowData[header] = cell.value ? cell.value.toString() : '';
          });
          
          previewData.push(rowData);
        }
      }
    }

    // 데이터 검증
    const validation = validateOrderData(previewData, headers);

    console.log('✅ 파일 처리 완료:', {
      headers: headers.length,
      previewRows: previewData.length,
      isValid: validation.isValid
    });

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileId: req.file.filename,
      headers: headers,
      previewData: previewData,
      totalRows: previewData.length,
      validation: validation,
      message: `파일이 성공적으로 업로드되었습니다. ${previewData.length}행의 데이터를 확인했습니다.`
    });

  } catch (error) {
    console.error('❌ 파일 업로드 오류:', error);
    res.status(500).json({ 
      error: '파일 처리 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 🔄 필드 매핑 설정 저장
router.post('/mapping', (req, res) => {
  try {
    const { mappingName, sourceFields, targetFields, mappingRules } = req.body;
    
    // 매핑 규칙을 파일로 저장 (나중에 DB로 변경)
    const mappingData = {
      name: mappingName,
      createdAt: new Date().toISOString(),
      sourceFields,
      targetFields,
      rules: mappingRules
    };

    // mappings 폴더도 /tmp 하위에 생성
    const mappingPath = process.env.NODE_ENV === 'production' 
      ? path.join('/tmp', 'mappings')
      : path.join(__dirname, '../file/mappings');
      
    if (!fs.existsSync(mappingPath)) {
      fs.mkdirSync(mappingPath, { recursive: true });
    }

    fs.writeFileSync(
      path.join(mappingPath, `${mappingName}.json`),
      JSON.stringify(mappingData, null, 2)
    );

    console.log('✅ 매핑 저장됨:', path.join(mappingPath, `${mappingName}.json`));

    res.json({
      success: true,
      message: '매핑 규칙이 저장되었습니다.',
      mappingId: mappingName
    });

  } catch (error) {
    console.error('❌ 매핑 저장 오류:', error);
    res.status(500).json({ 
      error: '매핑 저장 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📋 발주서 생성
router.post('/generate', async (req, res) => {
  try {
    const { fileId, mappingId, templateType } = req.body;
    
    console.log('📋 발주서 생성 요청:', { fileId, mappingId, templateType });
    
    // 업로드된 파일 경로
    const uploadedFilePath = path.join(uploadsDir, fileId);
    if (!fs.existsSync(uploadedFilePath)) {
      console.log('❌ 업로드된 파일을 찾을 수 없음:', uploadedFilePath);
      return res.status(404).json({ error: '업로드된 파일을 찾을 수 없습니다.' });
    }

    // 매핑 규칙 로드
    const mappingPath = process.env.NODE_ENV === 'production' 
      ? path.join('/tmp', 'mappings', `${mappingId}.json`)
      : path.join(__dirname, '../file/mappings', `${mappingId}.json`);
      
    let mappingRules = {};
    if (fs.existsSync(mappingPath)) {
      mappingRules = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }

    // 템플릿 파일 로드
    const templatePath = path.join(__dirname, '../file/porder_template.xlsx');
    
    // 데이터 변환 및 발주서 생성
    const result = await convertToStandardFormat(uploadedFilePath, templatePath, mappingRules);
    
    console.log('✅ 발주서 생성 완료:', result.fileName);
    
    res.json({
      success: true,
      generatedFile: result.fileName,
      downloadUrl: `/api/orders/download/${result.fileName}`,
      processedRows: result.processedRows,
      errors: result.errors,
      message: '발주서가 성공적으로 생성되었습니다.'
    });

  } catch (error) {
    console.error('❌ 발주서 생성 오류:', error);
    res.status(500).json({ 
      error: '발주서 생성 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📥 생성된 발주서 다운로드
router.get('/download/:fileName', (req, res) => {
  try {
    const fileName = req.params.fileName;
    const filePath = path.join(uploadsDir, fileName);
    
    console.log('📥 다운로드 요청:', filePath);
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ 다운로드 파일을 찾을 수 없음:', filePath);
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('❌ 파일 다운로드 오류:', err);
        res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
      } else {
        console.log('✅ 파일 다운로드 완료:', fileName);
      }
    });

  } catch (error) {
    console.error('❌ 다운로드 오류:', error);
    res.status(500).json({ 
      error: '파일 다운로드 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

module.exports = router; 