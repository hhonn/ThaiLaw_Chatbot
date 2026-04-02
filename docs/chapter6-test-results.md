# 6. การทดสอบหรือการประเมินผล

## 6.1 วิธีทดสอบหรือประเมินผลที่ใช้

การประเมินผลแบ่งเป็น 4 ส่วนหลักเพื่อให้ครอบคลุมทั้งระบบและ Data/AI

1. Static/Build Validation
- Backend: compileall เพื่อตรวจ syntax ของ `app/`, `ingest/`, และ `evaluate.py`
- Frontend: `npm run -s build` เพื่อตรวจ TypeScript + Next.js integration

2. Retrieval Evaluation (Data/AI)
- ใช้สคริปต์ `evaluate.py --retrieval-only`
- วัดบน 2 ชุดข้อมูล:
  - Main set: 31 เคส (มี ground truth)
  - Held-out set: 16 เคส (ไม่ใช้ tuning)
- Metrics ที่ใช้: Hit Rate, MRR, Precision@K, Recall@K, Avg retrieval time

3. Runtime API Smoke Test
- ทดสอบ `GET /api/health`
- ทดสอบ `POST /api/chat` ด้วยคำถามจริง 3 เคส
- เก็บ latency, domain, risk, และการมี citation

4. Data Integrity Test (Analytics)
- ตรวจฐาน `data/analytics/usage.sqlite3`
- เปรียบเทียบจำนวน event ทั้งหมดกับ sample event

---

## 6.2 ตัวอย่างกรณีทดสอบ / เกณฑ์ประเมิน / metric

### A) Retrieval Evaluation Cases (ตัวอย่าง)
1. ทำงานมา 5 ปี ถูกเลิกจ้าง ได้ค่าชดเชยเท่าไหร่ (GT: มาตรา 118)
2. นายจ้างหักเงินเดือนโดยไม่บอกล่วงหน้า (GT: มาตรา 76)
3. บริษัทเก็บข้อมูลส่วนบุคคลโดยไม่ขออนุญาต (GT: PDPA มาตรา 19)

### B) Runtime API Cases
1. ทำงานมา 5 ปี ถูกเลิกจ้าง ได้ค่าชดเชยเท่าไหร่
2. บริษัทเก็บข้อมูลส่วนบุคคลโดยไม่ขออนุญาต ผิดไหม
3. ซื้อสินค้าออนไลน์แล้วอยากคืน ทำได้ไหม

### เกณฑ์ผ่านที่ใช้
1. Build ผ่านทั้ง frontend/backend
2. Health endpoint ตอบ 200
3. Chat endpoint ตอบได้จริงและมี citation
4. Retrieval บน main set มี Hit Rate >= 80%
5. Sample events ใน analytics ต้องเป็น 0

### Metrics ที่รายงาน
1. Retrieval: Hit Rate, MRR, Precision@K, Recall@K, Avg retrieval time
2. Runtime: API latency (ms), citation presence
3. Data integrity: total_events, sample_events, real_events

---

## 6.3 ผลเบื้องต้นจากการทดสอบจริง

## 6.3.1 Static/Build Validation
1. Backend compileall: ผ่าน (`compileall-ok`)
2. Frontend build: ผ่าน (Next.js build สำเร็จ, route `/` และ `/analytics` ถูก generate)

## 6.3.2 Retrieval Evaluation (Main Set)
- จำนวนเคส: 31
- Hit Rate: 90.3% (28/31)
- MRR: 0.7530
- Avg Precision@K: 18.1%
- Avg Recall@K: 87.1%
- Avg retrieval time: 4.16 วินาที/เคส

เคสที่พลาดหลัก (Main set)
1. ค่าล่วงเวลาวันหยุดคิดกี่เท่า (miss มาตรา 61)
2. นายจ้างหักเงินเดือนโดยไม่บอกล่วงหน้า (miss มาตรา 76)
3. สุนัขกัดคน ต้องรับผิดชอบไหม (miss มาตรา 433)

## 6.3.3 Retrieval Evaluation (Held-out Set)
- จำนวนเคส: 16
- Hit Rate: 81.2% (13/16)
- MRR: 0.7500
- Avg Precision@K: 11.7%
- Avg Recall@K: 81.2%
- Avg retrieval time: 3.95 วินาที/เคส

เคสที่พลาดหลัก (Held-out set)
1. เวลาทำงานปกติต่อวันกี่ชั่วโมง (miss มาตรา 23)
2. สิทธิพักระหว่างทำงาน (miss มาตรา 27)
3. ขับรถชนคนบาดเจ็บ ต้องรับผิดอะไรบ้าง (miss มาตรา 420)

## 6.3.4 Runtime API Smoke Test
ผล `POST /api/chat` (3 เคส)
1. เคสแรงงานเลิกจ้าง: latency 24,878 ms, domain = แรงงาน, มี citation
2. เคส PDPA: latency 25,324 ms, domain = PDPA, มี citation
3. เคสผู้บริโภค: latency 29,832 ms, domain = ผู้บริโภค, มี citation

ค่าเฉลี่ย latency (3 เคส): 26,678 ms

`GET /api/health`: ตอบ `{"status":"ok","model":"typhoon-v2.5-30b-a3b-instruct"}`

## 6.3.5 Data Integrity Test (Analytics)
- total_events = 29
- sample_events = 0
- real_events = 29

สรุป: ชุด analytics ที่ใช้ประเมินเป็นข้อมูลใช้งานจริงเท่านั้น

---

## 6.4 วิเคราะห์ผลและ Insight ของข้อมูล

1. ระบบ retrieval ให้ผลดีบน main set (Hit Rate > 90%) สะท้อนว่า hybrid retrieval + rerank มีประสิทธิภาพในโจทย์หลัก
2. Held-out ลดลงเหลือ 81.2% แสดงช่องว่างด้าน generalization ในบางหัวข้อที่อิงมาตราเฉพาะ
3. Precision@K ยังต่ำกว่าที่ต้องการ สื่อว่าผลลำดับต้นยังมีเอกสารไม่เกี่ยวข้องปะปน
4. Runtime latency ค่อนข้างสูง (เฉลี่ย ~26.7s ใน smoke test) เหมาะสำหรับปรับปรุงด้านความเร็วเพื่อใช้งานจริง
5. Domain classification ใน smoke test ตรงคำถามตัวอย่าง และ citation มีครบทุกเคสที่ทดสอบ

---

## 6.5 สิ่งที่พบและแนวทางปรับปรุง

1. ปรับ retrieval สำหรับมาตราที่พลาดซ้ำ
- เพิ่ม synonym/alias ของมาตรา (เช่น มาตรา 23, 27, 61, 76, 420, 433)
- เพิ่ม lexical boost สำหรับ query ที่มี pattern ตัวเลขมาตรา

2. ปรับอันดับเอกสาร (Ranking Quality)
- เพิ่ม threshold และ diversity constraints ในขั้น rerank
- tune น้ำหนัก RRF ระหว่าง BM25 กับ vector ตามโดเมน

3. ลด latency
- cache embedding/query rewrite สำหรับคำถามที่พบบ่อย
- preload model และลดงานที่ไม่จำเป็นใน request path
- พิจารณาแยก worker สำหรับ retrieval กับ generation

4. ยกระดับการประเมิน
- เพิ่ม benchmark held-out ให้ครอบคลุมแพ่ง/แรงงาน/ผู้บริโภค/PDPA อย่างสมดุล
- รายงาน confidence interval เมื่อจำนวนเคสเพิ่มขึ้น

5. ประเมินเชิงเปรียบเทียบ baseline เพิ่มเติม
- BM25 only vs Vector only vs Hybrid no-rerank vs Hybrid+rereank (ปัจจุบัน)
- ใช้เกณฑ์เดียวกันทุกชุดเพื่อให้สรุปผลเชิงวิทยาศาสตร์มากขึ้น

---

## 6.6 สรุปผลการทดสอบ

จากผลทดสอบจริง ระบบผ่านเกณฑ์การใช้งานหลักทั้งด้านการทำงานของระบบและคุณภาพ retrieval ระดับใช้งานได้ โดยมีจุดเด่นคือความสามารถในการดึงเอกสารอ้างอิงได้ดีใน main set และรักษาผลระดับยอมรับได้ใน held-out set อย่างไรก็ตามยังมีประเด็นสำคัญที่ต้องพัฒนาต่อคือ precision ของเอกสารอันดับต้นและเวลา response ให้เหมาะกับการใช้งานภาคสนามมากขึ้น.
