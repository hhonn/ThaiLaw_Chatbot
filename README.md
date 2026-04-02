---
title: Thai Law Chatbot
emoji: ⚖️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: "4.44.0"
app_file: app/app.py
pinned: false
license: mit
short_description: ถาม-ตอบกฎหมายไทยด้านแรงงานและผู้บริโภค
---

# ⚖️ Thai Law Chatbot

แชทบอทให้ข้อมูลกฎหมายไทยด้านแรงงานและผู้บริโภค ขับเคลื่อนด้วย RAG (Retrieval-Augmented Generation) + Typhoon API

## ฟีเจอร์
- 🔍 ค้นหาข้อมูลจากกฎหมายจริง 67+ มาตรา
- 💬 รองรับการสนทนาต่อเนื่อง (chat history)
- ⚡ ตอบแบบ streaming แบบ real-time
- 📌 แสดงแหล่งอ้างอิงกฎหมายพร้อมลิงก์
- 🏷️ จำแนกหมวดกฎหมายและระดับความเสี่ยง

## กฎหมายที่ครอบคลุม
- พ.ร.บ. คุ้มครองแรงงาน พ.ศ. 2541
- พ.ร.บ. คุ้มครองผู้บริโภค พ.ศ. 2522
- ประมวลกฎหมายแพ่งและพาณิชย์
- ประมวลกฎหมายอาญา (มาตราที่เกี่ยวข้อง)
- พ.ร.บ. แรงงานสัมพันธ์ พ.ศ. 2518
- พ.ร.บ. ประกันสังคม พ.ศ. 2533
- พ.ร.บ. เงินทดแทน พ.ศ. 2537
- พ.ร.บ. วิธีพิจารณาคดีแรงงาน พ.ศ. 2522
- พ.ร.บ. ขายตรงและตลาดแบบตรง พ.ศ. 2545

## การติดตั้งและรัน (local)

```bash
# Clone
git clone <your-repo>
cd thai-law-chatbot

# สร้าง .env จาก template
cp .env.example .env
# แก้ TYPHOON_API_KEY ใน .env

# ติดตั้ง dependencies
pip install -r requirements.txt

# Rebuild vector store (ถ้ายังไม่มี หรืออัพเดทข้อมูล)
python ingest/build_chroma.py

# รันแอป
python app/app.py
```

## HuggingFace Spaces Deployment
ตั้งค่า Secret `TYPHOON_API_KEY` ใน Space Settings ของคุณ

## Analytics Operations (Production)

ระบบ analytics export มีการแยกไฟล์ดังนี้:
- `train/exports/real` สำหรับ snapshot ข้อมูลใช้งานจริง
- `train/exports/samples` สำหรับ snapshot ที่สร้างจาก sample generator

ระบบจะลบไฟล์ snapshot เก่าอัตโนมัติจาก retention policy โดยอ่านจาก env:
- `ANALYTICS_EXPORT_RETENTION_DAYS=30`

### รัน one-click pipeline เอง

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_daily_bootstrap.ps1 -BaseUrl "http://127.0.0.1:8000"
```

### ตั้ง schedule รายวันบน Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register_daily_bootstrap_task.ps1 -RunTime "02:00"
```

ตัว task จะเรียก `scripts/run_daily_bootstrap.ps1` ทุกวันตามเวลาที่กำหนด

## OpenLaw Data Integration (Phase-by-Phase)

### Phase 1: ดึงข้อมูล OpenLaw OCS Krisdika

```bash
python ingest/fetch_openlaw_krisdika.py --latest-only --max-rows 8000
```

ผลลัพธ์จะถูกบันทึกที่ `ingest/laws_openlaw_krisdika.json`

### Phase 2: รวม OpenLaw เข้ากับ Chroma index

```bash
# Windows PowerShell
$env:INCLUDE_OPENLAW="1"
python ingest/build_chroma.py
```

ถ้าไม่ต้องการรวม OpenLaw ให้ปิดด้วย:

```bash
$env:INCLUDE_OPENLAW="0"
python ingest/build_chroma.py
```

### Phase 3: รันแอปและทดสอบผล

```bash
python app/app.py
```

แนะนำให้เทียบคำถามชุดเดิมก่อน-หลังเปิด `INCLUDE_OPENLAW=1` เพื่อวัดความแม่นยำและคุณภาพ citation

> ⚠️ แอปนี้ให้ข้อมูลกฎหมายเบื้องต้นเท่านั้น ไม่ใช่คำปรึกษาทางกฎหมายอย่างเป็นทางการ  
> สำหรับกรณีสำคัญ ควรปรึกษาทนายความหรือหน่วยงานที่เกี่ยวข้อง
