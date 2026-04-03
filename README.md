# Thai Law Chatbot

ระบบถาม-ตอบกฎหมายไทยด้วยสถาปัตยกรรม RAG โดยแยกเป็น

- Backend: FastAPI + LangChain + Chroma + Typhoon API
- Frontend: Next.js App Router
- Analytics: SQLite + data export สำหรับงานฝึกสอนโมเดล

โครงการนี้รองรับการถามตอบแบบสตรีม (SSE), citation จากแหล่งกฎหมาย, OTP login ผ่านอีเมล และ pipeline สำหรับเก็บ/ส่งออกข้อมูลเชิงวิเคราะห์

## ไฮไลต์ของระบบ

- Hybrid retrieval: BM25 + Vector search + reranker (CrossEncoder)
- Streaming answer ผ่าน `/api/chat/stream`
- Domain / risk classification ในผลลัพธ์
- Analytics event logging พร้อม anonymization และ redaction
- Export ชุดข้อมูลฝึกสอนเป็น `questions`, `pairs`, `instruction` (native/chatml/alpaca)
- สร้าง snapshot ชุดข้อมูลจริงและ sample ได้อัตโนมัติ

## เทคโนโลยีหลัก

- Python: FastAPI, Uvicorn, LangChain, ChromaDB, sentence-transformers
- LLM API: Typhoon (`typhoon-v2.5-30b-a3b-instruct`)
- Frontend: Next.js 16, React 19, TypeScript
- Storage: SQLite (`data/analytics/usage.sqlite3`) และ Chroma local persistence

## โครงสร้างโปรเจกต์

```text
app/                 # FastAPI backend + RAG chain + auth + analytics
frontend/            # Next.js frontend
ingest/              # scripts สร้าง/รวมข้อมูลกฎหมายและ build Chroma
scripts/             # PowerShell งาน schedule/bootstrap
train/exports/       # analytics export snapshots
data/                # local DB และ Chroma persistence
evaluate.py          # retrieval/answer evaluation
eval_results.json    # ผลลัพธ์ evaluation ล่าสุด
```

## การตั้งค่าเริ่มต้น (Backend)

1. สร้าง env file

```powershell
Copy-Item .env.example .env
```

2. เติมค่าใน `.env` อย่างน้อย

- `TYPHOON_API_KEY`
- `SMTP_EMAIL`, `SMTP_PASSWORD` (ถ้าต้องการใช้งาน OTP)
- `ANALYTICS_ADMIN_KEY` (ถ้าต้องการป้องกัน endpoint analytics ฝั่ง admin)

3. ติดตั้ง dependencies

```powershell
pip install -r requirements.txt
```

4. สร้าง/อัปเดต Chroma index

```powershell
python ingest/build_chroma.py
```

5. รัน backend API

```powershell
python app/api.py
```

ทดสอบ health check:

```powershell
curl http://127.0.0.1:8000/api/health
```

## การรัน Frontend

```powershell
cd frontend
npm install
npm run dev
```

ค่า default ของ frontend จะเรียก backend ที่ `http://127.0.0.1:8000`
ถ้าต้องการเปลี่ยน ให้ตั้ง `NEXT_PUBLIC_API_URL` ในไฟล์ `frontend/.env.local`

## API หลัก

- `GET /api/health`
- `POST /api/chat`
- `POST /api/chat/stream` (SSE)
- `POST /api/auth/send-code`
- `POST /api/auth/verify-code`
- `POST /api/analytics/event`
- `GET /api/analytics/summary` (admin key ถ้าตั้ง `ANALYTICS_ADMIN_KEY`)
- `GET /api/analytics/users` (admin key)
- `POST /api/analytics/export` (admin key)
- `POST /api/analytics/export/snapshot` (admin key)
- `POST /api/analytics/generate-samples` (admin key)
- `POST /api/analytics/bootstrap-training-data` (admin key)

## Evaluation

รันแบบ retrieval-only (ไม่เรียก LLM):

```powershell
python evaluate.py --retrieval-only
```

รันแบบ answer quality:

```powershell
python evaluate.py --answer-only
```

รันบน held-out set:

```powershell
python evaluate.py --held-out
```

ผลลัพธ์จะบันทึกที่ `eval_results.json`

## OpenLaw Integration (Optional)

ดึงข้อมูล OpenLaw:

```powershell
python ingest/fetch_openlaw_krisdika.py --latest-only --max-rows 8000
```

รวม OpenLaw เข้า index:

```powershell
$env:INCLUDE_OPENLAW="1"
python ingest/build_chroma.py
```

ปิดการรวม OpenLaw:

```powershell
$env:INCLUDE_OPENLAW="0"
python ingest/build_chroma.py
```

## Analytics Bootstrap / Schedule (Windows)

รัน bootstrap ทันที:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily_bootstrap.ps1 -BaseUrl "http://127.0.0.1:8000"
```

ลงทะเบียน task รายวัน:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register_daily_bootstrap_task.ps1 -RunTime "02:00"
```

## หมายเหตุ

- โปรเจกต์นี้เป็นเครื่องมือให้ข้อมูลกฎหมายเบื้องต้น ไม่ใช่คำปรึกษากฎหมายอย่างเป็นทางการ
- สำหรับประเด็นสำคัญหรือมีผลทางคดี ควรปรึกษาทนายความหรือหน่วยงานที่เกี่ยวข้อง
