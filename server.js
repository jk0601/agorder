const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// uploads 폴더 확인 및 생성 (개발환경용 - 프로덕션에서는 Supabase Storage 사용)
const uploadsDir = path.join(__dirname, 'uploads');

if (process.env.NODE_ENV !== 'production' && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 uploads 폴더가 생성되었습니다:', uploadsDir);
}

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 파일 업로드 설정 - 메모리 스토리지 사용 (Supabase로 직접 업로드)
const storage = process.env.NODE_ENV === 'production' 
  ? multer.memoryStorage()  // 프로덕션: 메모리에 임시 저장 후 Supabase로 업로드
  : multer.diskStorage({    // 개발환경: 디스크 저장
      destination: function (req, file, cb) {
        cb(null, uploadsDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.mimetype === 'application/vnd.ms-excel' ||
                     file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('파일 형식이 지원되지 않습니다. Excel(.xlsx, .xls) 또는 CSV 파일만 업로드 가능합니다.'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB 제한
});

// API 라우트
const orderRoutes = require('./routes/orders');
const emailRoutes = require('./routes/email');

app.use('/api/orders', orderRoutes);
app.use('/api/email', emailRoutes);

// 홈페이지 라우트
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 에러 핸들링
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '파일 크기가 너무 큽니다. 10MB 이하의 파일을 업로드해주세요.' });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`📁 파일 업로드: http://localhost:${PORT}`);
  console.log(`📂 업로드 디렉토리: ${uploadsDir}`);
}); 