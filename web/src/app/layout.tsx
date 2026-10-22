import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/torob/theme-provider";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-vazirmatn",
});

export const metadata: Metadata = {
  title: "ترب‌گرد | دستیار خرید تهران",
  description:
    "ترب‌گرد — دستیار خرید هوشمند تهران. جست‌وجوی محصولات، مقایسه قیمت‌ها در فروشگاه‌های تهران و پیدا کردن بهترین پیشنهاد.",
  keywords: [
    "ترب‌گرد",
    "خرید تهران",
    "مقایسه قیمت",
    "دستیار خرید",
    "Torobgard",
    "Tehran shopping",
  ],
  authors: [{ name: "Torobgard" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ترب‌گرد | دستیار خرید تهران",
    description: "دستیار خرید هوشمند تهران — جست‌وجو، مقایسه و برنامه‌ریزی خرید",
    siteName: "ترب‌گرد",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body
        className={`${vazirmatn.variable} font-vazirmatn antialiased bg-background text-foreground min-h-screen`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
