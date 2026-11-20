import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/state/app-state";
import { PwaRegister } from "@/components/shell/Pwa";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const instrumentSerif = Instrument_Serif({ 
  weight: "400", 
  subsets: ["latin"], 
  variable: "--font-instrument" 
});

export const metadata: Metadata = {
  title: "LayahTools",
  description: "Get more done with your files.",
  appleWebApp: { capable: true, title: "LayahTools", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#2400c6" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="font-sans bg-[#f8f9fa] text-slate-900 min-h-screen flex flex-col">
        <PwaRegister />
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
