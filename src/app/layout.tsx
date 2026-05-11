import type { Metadata } from "next";
import "./globals.css";
import CookieConsent from "@/components/CookieConsent";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Goldfish - גייס משאבים עתיק ששוחה במים",
  description: "צ'אטבוט AI לגיוס משאבים לעמותות. סריקת קולות קוראים, כתיבת הגשות, וזיכרון ארגוני.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <body className="min-h-full bg-bg text-text font-rubik antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
