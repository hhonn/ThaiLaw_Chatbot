import argparse
import json
import logging
import os
import sys
import time
from typing import List, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")

# Test cases: (question, expected_keywords, expected_domain)
# Each test has:
    #   - question: the user question
    #   - must_contain: keywords that MUST appear in the answer
    #   - should_contain: keywords that SHOULD appear (partial credit)
    #   - domain: expected domain classification

TEST_CASES = [
    # แรงงาน: ค่าชดเชย
    {
        "question": "ทำงานมา 5 ปี ถูกเลิกจ้าง ได้ค่าชดเชยเท่าไหร่",
        "must_contain": ["180", "วัน"],
        "should_contain": ["มาตรา 118", "ค่าชดเชย", "เลิกจ้าง"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 118"),
        ],
    },
    {
        "question": "ทำงานครบ 120 วันถูกเลิกจ้าง ได้ค่าชดเชยไหม",
        "must_contain": ["30", "วัน"],
        "should_contain": ["มาตรา 118", "ค่าชดเชย"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 118"),
        ],
    },
    {
        "question": "เลิกจ้างเพราะยุบตำแหน่ง ต้องจ่ายอะไรบ้าง",
        "must_contain": ["ค่าชดเชย"],
        "should_contain": ["สินจ้าง", "บอกกล่าวล่วงหน้า", "วันหยุด"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 118"),
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 17"),
        ],
    },
    # แรงงาน: ค่าล่วงเวลา
    {
        "question": "ค่าล่วงเวลาวันหยุดคิดกี่เท่า",
        "must_contain": ["3"],
        "should_contain": ["เท่า", "ค่าจ้าง"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 61"),
        ],
    },
    {
        "question": "นายจ้างบังคับทำ OT ทำได้ไหม",
        "must_contain": ["ยินยอม"],
        "should_contain": ["บังคับ", "มาตรา", "ร้องเรียน"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 24"),
        ],
    },
    # แรงงาน: ลา
    {
        "question": "ลาคลอดมีสิทธิกี่วัน",
        "must_contain": ["120"],
        "should_contain": ["วัน", "ค่าจ้าง", "60"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 41"),
        ],
    },
    {
        "question": "ลาป่วยได้กี่วันต่อปี",
        "must_contain": ["30"],
        "should_contain": ["วัน", "ค่าจ้าง", "ใบรับรองแพทย์"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 32"),
        ],
    },
    {
        "question": "ลาบวชได้กี่วัน",
        "must_contain": ["120"],
        "should_contain": ["วัน", "อุปสมบท", "ข้าราชการ"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พ.ร.บ.คุ้มครองแรงงาน พ.ศ. 2541", "แนวปฏิบัติ (ลาบวชภาคเอกชน)"),
            ("ระเบียบสำนักนายกรัฐมนตรี", "ข้อ 19 (ลาอุปสมบท)"),
        ],
    },
    # แรงงาน: สัญญาจ้าง
    {
        "question": "ทำงานไม่มีสัญญาจ้าง มีสิทธิอะไรบ้าง",
        "must_contain": ["สิทธิ"],
        "should_contain": ["คุ้มครองแรงงาน", "ค่าชดเชย", "ไม่จำเป็น", "หนังสือ"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำถามที่พบบ่อย", "ทำงานไม่มีสัญญาจ้าง"),
        ],
    },
    {
        "question": "สัญญาจ้าง 1 ปี ต่อสัญญาหลายครั้ง ถือเป็นสัญญาอะไร",
        "must_contain": ["ไม่มีกำหนด"],
        "should_contain": ["ระยะเวลา", "ค่าชดเชย"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 4780/2556"),
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 575"),
        ],
    },
    # แรงงาน: หักเงิน
    {
        "question": "นายจ้างหักเงินเดือนโดยไม่บอกล่วงหน้าผิดกฎหมายไหม",
        "must_contain": ["ไม่มีสิทธิ"],
        "should_contain": ["มาตรา 76", "หักค่าจ้าง", "ยินยอม"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 76"),
        ],
    },
    # แรงงาน: เกษียณ
    {
        "question": "เกษียณอายุถือเป็นการเลิกจ้างไหม",
        "must_contain": ["เลิกจ้าง"],
        "should_contain": ["ค่าชดเชย", "มาตรา 118"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 118"),
        ],
    },
    # ผู้บริโภค: คืนสินค้า
    {
        "question": "ซื้อสินค้าออนไลน์แล้วอยากคืน ทำได้ไหม",
        "must_contain": ["7", "วัน"],
        "should_contain": ["คืน", "สินค้า", "สคบ"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("พระราชบัญญัติขายตรงและตลาดแบบตรง พ.ศ. 2545", "มาตรา 33"),
        ],
    },
    {
        "question": "ซื้อของออนไลน์ได้ของปลอม ทำอย่างไร",
        "must_contain": ["ร้องเรียน"],
        "should_contain": ["สคบ", "หลักฐาน", "1166"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("คำถามที่พบบ่อย", "ซื้อของออนไลน์ได้ของปลอม"),
            ("กรณีร้องเรียน สคบ.", "กรณีศึกษา: สั่งซื้อสินค้าออนไลน์"),
        ],
    },
    # ผู้บริโภค: โฆษณา
    {
        "question": "โฆษณาอาหารเสริมว่ารักษาโรคมะเร็งได้ ผิดกฎหมายไหม",
        "must_contain": ["ผิด"],
        "should_contain": ["โฆษณาเกินจริง", "คุ้มครองผู้บริโภค"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองผู้บริโภค พ.ศ. 2522", "มาตรา 22"),
        ],
    },
    # ผู้บริโภค: อสังหา
    {
        "question": "คอนโดส่งมอบล่าช้า ผู้ซื้อทำอะไรได้บ้าง",
        "must_contain": ["ค่าเสียหาย"],
        "should_contain": ["เลิกสัญญา", "คืนเงิน", "ดอกเบี้ย"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 8765/2557"),
        ],
    },
    # ผู้บริโภค: เช่า
    {
        "question": "ผู้ให้เช่าไม่คืนเงินมัดจำ ทำอย่างไร",
        "must_contain": ["คืน"],
        "should_contain": ["เงินประกัน", "7 วัน", "สคบ"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 4512/2558"),
            ("คู่มือปฏิบัติ", "สิทธิผู้เช่าที่อยู่อาศัย"),
        ],
    },
    {
        "question": "ถูกไล่ออกจากห้องเช่าก่อนครบสัญญา ทำอย่างไร",
        "must_contain": ["สิทธิ"],
        "should_contain": ["ค่าเสียหาย", "สัญญาเช่า", "บอกเลิก"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 2345/2563"),
            ("คู่มือปฏิบัติ", "สิทธิผู้เช่าที่อยู่อาศัย"),
        ],
    },
    # อาญา: ฉ้อโกง
    {
        "question": "โดนหลอกให้โอนเงิน ต้องทำอย่างไร",
        "must_contain": ["แจ้งความ"],
        "should_contain": ["1441", "ฉ้อโกง", "72", "อายัด"],
        "domain": "อาญา",
        "relevant_docs": [
            ("ประมวลกฎหมายอาญา", "มาตรา 341"),
        ],
    },
    {
        "question": "แก๊งคอลเซ็นเตอร์โทรมาหลอก มีโทษอะไร",
        "must_contain": ["จำคุก"],
        "should_contain": ["ฉ้อโกง", "341", "คอมพิวเตอร์"],
        "domain": "อาญา",
        "relevant_docs": [
            ("ประมวลกฎหมายอาญา", "มาตรา 341"),
            ("พระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550", "มาตรา 14"),
        ],
    },
    # แพ่ง: ดอกเบี้ย / หนี้
    {
        "question": "ดอกเบี้ยเกินกฎหมายคิดได้เท่าไหร่",
        "must_contain": ["15"],
        "should_contain": ["ต่อปี", "โมฆะ", "654"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 654"),
        ],
    },
    {
        "question": "กู้เงินนอกระบบ ดอกเบี้ย 5% ต่อเดือน ต้องจ่ายไหม",
        "must_contain": ["ไม่ต้อง"],
        "should_contain": ["โมฆะ", "เงินต้น", "15%"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 654"),
        ],
    },
    # แพ่ง: ละเมิด
    {
        "question": "สุนัขของเราไปกัดคน ต้องรับผิดชอบไหม",
        "must_contain": ["รับผิด"],
        "should_contain": ["433", "เจ้าของสัตว์", "ค่าเสียหาย"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 433"),
        ],
    },
    # PDPA
    {
        "question": "บริษัทเก็บข้อมูลส่วนบุคคลโดยไม่ขออนุญาต ผิดไหม",
        "must_contain": ["ผิด"],
        "should_contain": ["ความยินยอม", "PDPA", "คุ้มครองข้อมูล"],
        "domain": "PDPA",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562", "มาตรา 19"),
        ],
    },
    {
        "question": "นายจ้างเปิดเผยข้อมูลสุขภาพลูกจ้าง ผิดไหม",
        "must_contain": ["ผิด"],
        "should_contain": ["ข้อมูลอ่อนไหว", "ความยินยอม"],
        "domain": "PDPA",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562", "มาตรา 26"),
        ],
    },
    # ครอบครัว
    {
        "question": "หย่ากัน สินสมรสแบ่งอย่างไร",
        "must_contain": ["ครึ่ง"],
        "should_contain": ["สินสมรส", "1474"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 1474"),
        ],
    },
    {
        "question": "ค่าเลี้ยงดูบุตรหลังหย่า ถ้าไม่จ่ายทำอย่างไร",
        "must_contain": ["บังคับ"],
        "should_contain": ["ศาล", "บุตร", "20", "บรรลุนิติภาวะ"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 3456/2561"),
        ],
    },
    # ออนไลน์ / ไซเบอร์
    {
        "question": "โพสต์หมิ่นประมาทในโซเชียล มีโทษอะไร",
        "must_contain": ["จำคุก"],
        "should_contain": ["328", "หมิ่นประมาท", "200,000"],
        "domain": "อาญา",
        "relevant_docs": [
            ("ประมวลกฎหมายอาญา", "มาตรา 328"),
            ("พระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550", "มาตรา 14"),
        ],
    },
    {
        "question": "ข้อความแชทไลน์ใช้เป็นหลักฐานในศาลได้ไหม",
        "must_contain": ["ได้"],
        "should_contain": ["อิเล็กทรอนิกส์", "หลักฐาน", "พยาน"],
        "domain": "แพ่ง",
        "relevant_docs": [],  # ไม่มี ground truth เฉพาะ — cross-domain
    },
    # ประกันสังคม
    {
        "question": "ถูกเลิกจ้าง ประกันสังคมจ่ายอะไรให้บ้าง",
        "must_contain": ["50"],
        "should_contain": ["ว่างงาน", "เงินทดแทน", "180"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คู่มือปฏิบัติ", "สิทธิประกันสังคมที่ต้องรู้"),
        ],
    },
    # เคสจริง (ตรวจว่าอ้างอิงฎีกาได้
    {
        "question": "มีเคสไหนที่ศาลตัดสินว่าเลิกจ้างไม่เป็นธรรมบ้าง",
        "must_contain": ["ฎีกา"],
        "should_contain": ["คำพิพากษา", "เลิกจ้าง", "ค่าชดเชย"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 1189/2529 (เลิกจ้างไม่เป็นธรรม)"),
        ],
    },
    {
        "question": "ลูกจ้างขาดงาน 3 วัน ถูกเลิกจ้างได้ไหม",
        "must_contain": ["119"],
        "should_contain": ["ไม่ต้องจ่าย", "ค่าชดเชย", "เหตุอันสมควร"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 119"),
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 3542/2549 (เลิกจ้าง-ขาดงาน 3 วัน)"),
        ],
    },
]

# Held-out Test Set

HELD_OUT_CASES = [
    # แรงงาน: เวลาทำงาน
    {
        "question": "เวลาทำงานปกติต่อวันกี่ชั่วโมง",
        "must_contain": ["8"],
        "should_contain": ["ชั่วโมง", "สัปดาห์", "48"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 23"),
        ],
    },
    # แรงงาน: พักระหว่างงาน
    {
        "question": "ลูกจ้างมีสิทธิพักระหว่างทำงานกี่ชั่วโมง",
        "must_contain": ["1"],
        "should_contain": ["ชั่วโมง", "พัก", "5"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 27"),
        ],
    },
    # แรงงาน: จ่ายค่าจ้างเมื่อเลิกจ้าง
    {
        "question": "ถูกเลิกจ้างแล้ว นายจ้างต้องจ่ายเงินเดือนค้างภายในกี่วัน",
        "must_contain": ["3"],
        "should_contain": ["วัน", "ค่าจ้าง", "67"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541", "มาตรา 67"),
        ],
    },
    # แรงงาน: ทดลองงาน
    {
        "question": "อยู่ระหว่างทดลองงาน ถูกเลิกจ้างมีสิทธิอะไรบ้าง",
        "must_contain": ["ค่าชดเชย"],
        "should_contain": ["120", "คุ้มครองแรงงาน", "บอกกล่าว"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 1095/2539 (ทดลองงาน)"),
        ],
    },
    # แรงงาน: อายุความค่าจ้าง
    {
        "question": "ค่าจ้างค้างจ่าย ฟ้องได้ภายในกี่ปี",
        "must_contain": ["2"],
        "should_contain": ["ปี", "อายุความ", "193"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 193/30"),
        ],
    },
    # แรงงาน: คุกคามทางเพศ
    {
        "question": "หัวหน้างานล่วงละเมิดทางเพศ ลูกจ้างทำอะไรได้บ้าง",
        "must_contain": ["ร้องเรียน"],
        "should_contain": ["ค่าชดเชย", "เลิกจ้าง", "นายจ้าง"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 7890/2559 (คุกคามทางเพศในที่ทำงาน)"),
        ],
    },
    # แรงงาน: อุบัติเหตุจากการทำงาน
    {
        "question": "ลูกจ้างประสบอุบัติเหตุในโรงงาน ได้เงินอะไรบ้าง",
        "must_contain": ["ค่ารักษาพยาบาล"],
        "should_contain": ["ค่าทดแทน", "เงินทดแทน", "นายจ้าง"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 6234/2549 (อุบัติเหตุจากการทำงาน)"),
        ],
    },
    # แรงงาน: ค่าจ้างขั้นต่ำ
    {
        "question": "ค่าจ้างขั้นต่ำวันละกี่บาท",
        "must_contain": ["330"],
        "should_contain": ["บาท", "วัน", "400"],
        "domain": "แรงงาน",
        "relevant_docs": [
            ("กฎหมายแรงงาน", "อัตราค่าจ้างขั้นต่ำ พ.ศ. 2568"),
        ],
    },
    # ผู้บริโภค: ทวงหนี้
    {
        "question": "เจ้าหนี้โทรทวงหนี้ตอนตี 2 ผิดกฎหมายไหม",
        "must_contain": ["ผิด"],
        "should_contain": ["08.00", "20.00", "ทวงถามหนี้"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558", "สาระสำคัญ"),
        ],
    },
    # ผู้บริโภค: รถมือสอง
    {
        "question": "ซื้อรถมือสองแล้วพบว่าเคยชนหนัก ทำอะไรได้บ้าง",
        "must_contain": ["คืนเงิน"],
        "should_contain": ["สคบ", "ปกปิด", "ผู้บริโภค"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("กรณีร้องเรียน สคบ.", "คดีรถยนต์มือสอง (พ.ศ. 2563)"),
        ],
    },
    # ผู้บริโภค: ฟิตเนสปิด
    {
        "question": "สมัครฟิตเนสแล้วฟิตเนสปิดสาขา ได้เงินคืนไหม",
        "must_contain": ["คืน"],
        "should_contain": ["เงิน", "สัญญา", "ดอกเบี้ย"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 5432/2561 (สัญญาบริการ-ฟิตเนส)"),
        ],
    },
    # ผู้บริโภค: คอร์สเรียนหลอก
    {
        "question": "ซื้อคอร์สเรียนออนไลน์แต่เนื้อหาไม่ตรงโฆษณา ทำอย่างไร",
        "must_contain": ["ร้องเรียน"],
        "should_contain": ["สคบ", "โฆษณาเกินจริง", "คืนเงิน"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("กรณีร้องเรียน สคบ.", "คดีคอร์สเรียนออนไลน์ (พ.ศ. 2565)"),
        ],
    },
    # อาญา: ยักยอกทรัพย์
    {
        "question": "พนักงานยักยอกเงินบริษัท มีโทษอย่างไร",
        "must_contain": ["จำคุก"],
        "should_contain": ["3", "ยักยอก", "352"],
        "domain": "อาญา",
        "relevant_docs": [
            ("ประมวลกฎหมายอาญา", "มาตรา 352"),
        ],
    },
    # แพ่ง: ละเมิด
    {
        "question": "ขับรถชนคนบาดเจ็บ ต้องรับผิดอะไรบ้าง",
        "must_contain": ["ค่าสินไหมทดแทน"],
        "should_contain": ["ละเมิด", "420", "ค่ารักษาพยาบาล"],
        "domain": "แพ่ง",
        "relevant_docs": [
            ("ประมวลกฎหมายแพ่งและพาณิชย์", "มาตรา 420"),
        ],
    },
    # PDPA: สิทธิเจ้าของข้อมูล
    {
        "question": "สิทธิของเจ้าของข้อมูลส่วนบุคคลมีอะไรบ้าง",
        "must_contain": ["ลบ"],
        "should_contain": ["เข้าถึง", "แก้ไข", "คัดค้าน"],
        "domain": "PDPA",
        "relevant_docs": [
            ("พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562", "มาตรา 29"),
        ],
    },
    # แพ่ง: บัตรเครดิต
    {
        "question": "ธนาคารเรียกเก็บค่าธรรมเนียมบัตรเครดิตโดยไม่แจ้ง ทำอย่างไร",
        "must_contain": ["ไม่เป็นธรรม"],
        "should_contain": ["คืนเงิน", "สัญญา"],
        "domain": "ผู้บริโภค",
        "relevant_docs": [
            ("คำพิพากษาศาลฎีกา", "ฎีกาที่ 9870/2561 (บัตรเครดิต-ค่าธรรมเนียมซ่อนเร้น)"),
        ],
    },
]


def _doc_key(doc) -> tuple:
    """Extract (law, section) key from a Document, stripping chunk suffixes."""
    law = doc.metadata.get("law", "").strip()
    sec = doc.metadata.get("section", "").strip()
    # Remove chunk suffixes like " (ส่วน 1/2)"
    import re as _re
    sec = _re.sub(r'\s*\(ส่วน \d+/\d+\)', '', sec)
    return (law, sec)


def _match_doc_to_gt(doc, gt_key: tuple) -> bool:
    
    """
    Flexible matching: check if a retrieved Document relates to a ground truth entry.

    Matching strategies (any one = match):
    1. Metadata match — both law AND section substring-match
    2. Content match — the ground-truth section string appears in page_content
    3. Court-case match — case number (e.g. 1189/2529) appears anywhere
    """

    import re as _re
    g_law, g_sec = gt_key
    r_law, r_sec = _doc_key(doc)
    content = doc.page_content if hasattr(doc, "page_content") else ""

    # Strategy 1: metadata match (law + section)
    law_meta = (g_law in r_law) or (r_law in g_law) if g_law and r_law else False
    sec_meta = (g_sec in r_sec) or (r_sec in g_sec) if g_sec and r_sec else False
    if law_meta and sec_meta:
        return True

    # Strategy 2: section reference in content
    # e.g. ground truth "มาตรา 118" appears in page_content
    if g_sec and g_sec in content:
        return True

    # Strategy 3: court case number match
    if "ฎีกา" in g_sec or "ฎีกา" in g_law:
        nums = _re.findall(r'(\d+/\d{4})', g_sec)
        for n in nums:
            if n in r_sec or n in content:
                return True
        # Fallback: case name substring
        case_name = g_sec.split("(")[0].strip()
        if case_name and (case_name in r_sec or case_name in content):
            return True

    return False

# Retrieval Evaluation

def evaluate_retrieval(verbose: bool = True, test_cases: list = None) -> dict:
    """
    Evaluate retrieval quality using Precision@K, Recall@K, Hit Rate, and MRR.
    This does NOT call the LLM — only the retrieval + reranking pipeline.
    """
    from rag_chain import retrieve_docs

    source = test_cases or TEST_CASES
    # Filter test cases that have ground truth
    cases_with_gt = [tc for tc in source if tc.get("relevant_docs")]

    results = {
        "total": len(cases_with_gt),
        "metrics": {
            "hit_rate": 0.0,
            "mrr": 0.0,
            "avg_precision_at_k": 0.0,
            "avg_recall_at_k": 0.0,
        },
        "details": [],
    }

    total_hit = 0
    total_rr = 0.0      # reciprocal rank
    total_prec = 0.0
    total_recall = 0.0
    total_time = 0.0

    print(f"\n{'='*70}")
    print(f"  Retrieval Evaluation — {len(cases_with_gt)} test cases (with ground truth)")
    print(f"{'='*70}\n")

    for i, tc in enumerate(cases_with_gt):
        q = tc["question"]
        gt_keys = [tuple(x) for x in tc["relevant_docs"]]

        t0 = time.time()
        try:
            docs = retrieve_docs(q)
        except Exception as e:
            docs = []
            print(f"  ⚠️ Error retrieving for: {q[:40]}... — {e}")
        elapsed = time.time() - t0
        total_time += elapsed

        retrieved_keys = [_doc_key(d) for d in docs]

        # Hit Rate: did we retrieve AT LEAST ONE relevant doc?
        hit = False
        first_rank = -1
        found_gt = []
        for gt in gt_keys:
            for rank, d in enumerate(docs):
                if _match_doc_to_gt(d, gt):
                    hit = True
                    found_gt.append(gt)
                    if first_rank == -1 or rank < first_rank:
                        first_rank = rank
                    break

        # Deduplicate found_gt
        found_gt_set = set(found_gt)

        # Hit Rate
        if hit:
            total_hit += 1

        # MRR: 1/(rank+1) of first relevant doc
        rr = 1.0 / (first_rank + 1) if first_rank >= 0 else 0.0
        total_rr += rr

        # Precision@K: how many of top-K are relevant
        relevant_in_topk = 0
        for d in docs:
            for gt in gt_keys:
                if _match_doc_to_gt(d, gt):
                    relevant_in_topk += 1
                    break
        precision = relevant_in_topk / len(docs) if docs else 0.0
        total_prec += precision

        # Recall@K: how many of ground-truth were found
        recall = len(found_gt_set) / len(gt_keys) if gt_keys else 1.0
        total_recall += recall

        status = "✅" if hit else "❌"
        detail = {
            "question": q,
            "hit": hit,
            "mrr": round(rr, 4),
            "precision_at_k": round(precision, 4),
            "recall_at_k": round(recall, 4),
            "retrieved_count": len(docs),
            "ground_truth": [list(x) for x in gt_keys],
            "found_gt": [list(x) for x in found_gt_set],
            "missed_gt": [list(x) for x in gt_keys if tuple(x) not in found_gt_set],
            "retrieved_docs": [list(rk) for rk in retrieved_keys[:5]],  # top 5 only
            "time": round(elapsed, 2),
        }
        results["details"].append(detail)

        if verbose:
            print(f"{status} [{i+1:2d}/{len(cases_with_gt)}] {q[:50]}...")
            print(f"   Hit: {'✓' if hit else '✗'} | MRR: {rr:.2f} | P@K: {precision:.2f} | "
                  f"R@K: {recall:.2f} | Found: {len(found_gt_set)}/{len(gt_keys)} | {elapsed:.1f}s")
            if not hit:
                print(f"   ❌ Missed: {[x[1] for x in gt_keys]}")
                print(f"   📄 Got: {[rk[1][:30] for rk in retrieved_keys[:3]]}")
            print()

    n = len(cases_with_gt)
    results["metrics"] = {
        "hit_rate": round(total_hit / n * 100, 1) if n else 0,
        "mrr": round(total_rr / n, 4) if n else 0,
        "avg_precision_at_k": round(total_prec / n * 100, 1) if n else 0,
        "avg_recall_at_k": round(total_recall / n * 100, 1) if n else 0,
        "avg_time": round(total_time / n, 2) if n else 0,
    }

    print(f"\n{'='*70}")
    print(f"  RETRIEVAL RESULTS")
    print(f"{'='*70}")
    print(f"  Hit Rate (≥1 relevant found):  {total_hit}/{n} ({results['metrics']['hit_rate']}%)")
    print(f"  MRR (Mean Reciprocal Rank):    {results['metrics']['mrr']:.4f}")
    print(f"  Avg Precision@K:               {results['metrics']['avg_precision_at_k']}%")
    print(f"  Avg Recall@K:                  {results['metrics']['avg_recall_at_k']}%")
    print(f"  Avg retrieval time:            {results['metrics']['avg_time']}s")
    print(f"{'='*70}\n")

    return results

# Answer Quality Evaluation

def evaluate_answer(verbose: bool = True, test_cases: list = None) -> dict:
    """Run answer quality evaluation (calls LLM for each question)."""
    from rag_chain import answer_question

    source = test_cases or TEST_CASES
    results = {
        "total": len(source),
        "must_pass": 0,
        "should_pass": 0,
        "domain_correct": 0,
        "avg_time": 0.0,
        "details": [],
    }

    total_time = 0.0
    print(f"\n{'='*70}")
    print(f"  Answer Quality Evaluation — {len(source)} test cases")
    print(f"{'='*70}\n")

    for i, tc in enumerate(source):
        q = tc["question"]
        must = tc["must_contain"]
        should = tc["should_contain"]
        expected_domain = tc["domain"]

        t0 = time.time()
        try:
            answer, citations, domain, risk = answer_question(q)
        except Exception as e:
            answer = f"[ERROR: {e}]"
            citations = domain = risk = ""
        elapsed = time.time() - t0
        total_time += elapsed

        answer_lower = answer.lower()

        must_hits = [kw for kw in must if kw.lower() in answer_lower]
        must_ok = len(must_hits) == len(must)

        should_hits = [kw for kw in should if kw.lower() in answer_lower]
        should_score = len(should_hits) / len(should) if should else 1.0

        domain_ok = domain == expected_domain

        if must_ok:
            results["must_pass"] += 1
        results["should_pass"] += should_score
        if domain_ok:
            results["domain_correct"] += 1

        status = "✅" if must_ok else "❌"
        detail = {
            "question": q,
            "must_ok": must_ok,
            "must_hits": must_hits,
            "must_miss": [kw for kw in must if kw.lower() not in answer_lower],
            "should_score": should_score,
            "should_hits": should_hits,
            "domain_ok": domain_ok,
            "domain_got": domain,
            "time": elapsed,
            "answer_len": len(answer),
        }
        results["details"].append(detail)

        if verbose:
            print(f"{status} [{i+1:2d}/{len(source)}] {q[:50]}...")
            print(f"   Must: {len(must_hits)}/{len(must)} | Should: {len(should_hits)}/{len(should)} | "
                  f"Domain: {domain} {'✓' if domain_ok else '✗'} | {elapsed:.1f}s | {len(answer)} chars")
            if not must_ok:
                print(f"   ❌ Missing: {detail['must_miss']}")
            print()

    results["avg_time"] = total_time / len(source)

    must_pct = results["must_pass"] / results["total"] * 100
    should_pct = results["should_pass"] / results["total"] * 100
    domain_pct = results["domain_correct"] / results["total"] * 100

    print(f"\n{'='*70}")
    print(f"  ANSWER QUALITY RESULTS")
    print(f"{'='*70}")
    print(f"  Must-contain accuracy:   {results['must_pass']}/{results['total']} ({must_pct:.1f}%)")
    print(f"  Should-contain avg:      {results['should_pass']:.1f}/{results['total']} ({should_pct:.1f}%)")
    print(f"  Domain classification:   {results['domain_correct']}/{results['total']} ({domain_pct:.1f}%)")
    print(f"  Average response time:   {results['avg_time']:.1f}s")
    print(f"  Total evaluation time:   {total_time:.1f}s")
    print(f"{'='*70}\n")

    if must_pct >= 90:
        grade = "A"
    elif must_pct >= 80:
        grade = "B"
    elif must_pct >= 70:
        grade = "C"
    elif must_pct >= 60:
        grade = "D"
    else:
        grade = "F"

    print(f"  Overall Grade: {grade} ({must_pct:.0f}%)")
    print()

    return results

# Full Evaluation (Retrieval + Answer)

def evaluate(verbose: bool = True, retrieval_only: bool = False, answer_only: bool = False,
             held_out: bool = False) -> dict:
    # Run full evaluation pipeline.

    test_cases = HELD_OUT_CASES if held_out else None
    label = "HELD-OUT" if held_out else "MAIN"
    all_results = {}

    # Retrieval evaluation (fast, no LLM calls)
    if not answer_only:
        ret_results = evaluate_retrieval(verbose=verbose, test_cases=test_cases)
        all_results["retrieval"] = ret_results

    # Answer quality evaluation (slow, calls LLM)
    if not retrieval_only:
        ans_results = evaluate_answer(verbose=verbose, test_cases=test_cases)
        all_results["answer"] = ans_results

    # Combined summary
    print(f"\n{'='*70}")
    print(f"  COMBINED EVALUATION SUMMARY")
    print(f"{'='*70}")
    if "retrieval" in all_results:
        m = all_results["retrieval"]["metrics"]
        print(f"  [Retrieval]  Hit Rate: {m['hit_rate']}% | MRR: {m['mrr']:.4f} | "
              f"P@K: {m['avg_precision_at_k']}% | R@K: {m['avg_recall_at_k']}%")
    if "answer" in all_results:
        a = all_results["answer"]
        must_pct = a["must_pass"] / a["total"] * 100
        should_pct = a["should_pass"] / a["total"] * 100
        domain_pct = a["domain_correct"] / a["total"] * 100
        print(f"  [Answer]     Must: {must_pct:.1f}% | Should: {should_pct:.1f}% | "
              f"Domain: {domain_pct:.1f}% | Time: {a['avg_time']:.1f}s")
    print(f"{'='*70}\n")

    # Save results
    output_path = os.path.join(os.path.dirname(__file__), "eval_results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2, default=str)
    print(f"  Results saved to: {output_path}")

    return all_results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Thai Law Chatbot Evaluation")
    parser.add_argument("--retrieval-only", action="store_true",
                        help="Only run retrieval evaluation (fast, no LLM)")
    parser.add_argument("--answer-only", action="store_true",
                        help="Only run answer quality evaluation")
    parser.add_argument("--held-out", action="store_true",
                        help="Run evaluation on held-out test set (not used for tuning)")
    args = parser.parse_args()

    evaluate(
        retrieval_only=args.retrieval_only,
        answer_only=args.answer_only,
        held_out=args.held_out,
    )