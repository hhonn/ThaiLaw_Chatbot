import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "⚖️ Thai Law Chatbot",
  description: "ระบบให้ข้อมูลกฎหมายเบื้องต้นด้วย AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}