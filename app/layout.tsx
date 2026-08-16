import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./readability.css";
import GlobalSaveFeedback from "./global-save-feedback";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const origin = host
    ? `${protocol}://${host}`
    : process.env.APP_ORIGIN?.trim() || "https://whizzup-sales-hub.vercel.app";
  const title = "위즈업 영업관리 | TM·미팅 통합관리";
  const description =
    "AI로 통화·미팅을 기록하고 학교·기관의 수주 진행 상태, 설치 실적과 영업 동선을 지도에서 관리합니다.";

  return {
    title,
    description,
    icons: {
      icon: [
        {
          url: "/whizzup-mark.png",
          type: "image/png",
          sizes: "512x512",
        },
      ],
      shortcut: "/whizzup-mark.png",
      apple: "/whizzup-mark.png",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: `${origin}/og-map.png`, width: 1736, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-map.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<GlobalSaveFeedback /></body>
    </html>
  );
}
