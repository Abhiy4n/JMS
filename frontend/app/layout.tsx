import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import { ToastProvider } from "@/components/toast/ToastProvider";
import AppChrome from "@/components/AppChrome";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "JMS",
    template: "%s · JMS",
  },
  description: "Job Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('jms-theme');if(t==='dark'||t==='gold'||t==='light')document.documentElement.dataset.jmsTheme=t;if(localStorage.getItem('jms-sidebar-collapsed')==='1')document.documentElement.dataset.jmsSidebar='collapsed';}catch(e){}})();` }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ToastProvider><AppChrome>{children}</AppChrome></ToastProvider>
      </body>
    </html>
  );
}
