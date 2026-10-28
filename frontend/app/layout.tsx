import type { Metadata } from "next";

import { ToastProvider } from "@/components/toast/ToastProvider";
import AppChrome from "@/components/AppChrome";
import "./globals.css";
import "./reconciliation.css";

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
      className="h-full antialiased"
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
