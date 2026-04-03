# Frontend (Next.js)

Frontend ของ Thai Law Chatbot ใช้ Next.js (App Router) และเชื่อมกับ FastAPI backend ผ่าน REST + SSE

## Development

```bash
npm install
npm run dev
```

เปิดที่ `http://localhost:3000`

## Backend URL

ค่า default ของ API คือ `http://127.0.0.1:8000`

หากต้องการเปลี่ยน endpoint ให้สร้างไฟล์ `.env.local` ในโฟลเดอร์นี้:

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

## Scripts

- `npm run dev` เริ่มโหมดพัฒนา
- `npm run build` build production
- `npm run start` รัน production server
- `npm run lint` ตรวจ lint

## โครงสร้างสำคัญ

- `app/page.tsx` หน้าแชทหลัก
- `app/analytics/page.tsx` หน้า analytics dashboard
- `app/components/*` UI components
- `app/lib/api.ts` API client และ SSE stream handler
- `app/lib/useChatHistory.ts` state/history logic