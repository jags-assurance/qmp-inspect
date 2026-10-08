// A small English -> Arabic dictionary for the shell (navigation, section headings, common buttons).
// Keyed by the English text itself, so existing components keep their English strings as the source of
// truth and only the DISPLAY changes: an unknown string simply stays English. The Arabic below should be
// reviewed by a native speaker before it is shown to clients.
import type { SupportedLocale } from "./direction";

const AR: Record<string, string> = {
  // Navigation
  "← JAGS Assurance": "← جاغز للتأكيد",
  Dashboard: "لوحة المعلومات",
  Projects: "المشاريع",
  ITPs: "خطط الفحص والاختبار",
  "Start work": "بدء العمل",
  Inspections: "عمليات الفحص",
  "Standalone Assignments": "المهام المستقلة",
  NCRs: "تقارير عدم المطابقة",
  Observations: "الملاحظات",
  "Document Vault": "خزنة المستندات",
  "Reports & Documents": "التقارير والمستندات",
  "Data Book / Handover": "كتاب البيانات / التسليم",
  "Punch list (choose a project)": "قائمة الملاحظات (اختر مشروعاً)",
  Notifications: "الإشعارات",
  Manage: "الإدارة",
  Guide: "الدليل",
  Settings: "الإعدادات",
  "Master ITP Library": "المكتبة الرئيسية لخطط الفحص",
  "Checklist Library": "مكتبة قوائم التحقق",
  "Client Organisations": "مؤسسات العملاء",
  "Client Teams": "فرق العملاء",
  "Staff Access": "صلاحيات الموظفين",
  Teams: "الفرق",
  "Custom Roles": "الأدوار المخصصة",
  Numbering: "الترقيم",
  "Brand Colors": "ألوان العلامة",
  "Automation Rules": "قواعد الأتمتة",
  "Portfolio Insights": "تحليلات المحفظة",
  "Usage & Cost": "الاستخدام والتكلفة",
  Reporting: "إعداد التقارير",
  "Cloud Folder Sync": "مزامنة المجلدات السحابية",
  "Document Traceability": "تتبع المستندات",
  "Intervention Levels": "مستويات التدخل",
  "Plans & Seats": "الخطط والمقاعد",
  "Module Licensing": "ترخيص الوحدات",
  "Document Retention": "الاحتفاظ بالمستندات",
  "NCR Root Causes": "الأسباب الجذرية لعدم المطابقة",
  // Sidebar section headings
  Plan: "التخطيط",
  Execute: "التنفيذ",
  Quality: "الجودة",
  Records: "السجلات",
  Admin: "الإدارة",
  Help: "المساعدة",
  // Common buttons and labels
  Save: "حفظ",
  Cancel: "إلغاء",
  Delete: "حذف",
  Search: "بحث",
  Edit: "تعديل",
  Close: "إغلاق",
  Back: "رجوع",
  Submit: "إرسال",
  Confirm: "تأكيد",
  "Sign out": "تسجيل الخروج",
  Open: "مفتوح",
  Closed: "مغلق",
  Overdue: "متأخر",
  Yes: "نعم",
  No: "لا",
  "N/A": "لا ينطبق",
  Loading: "جارٍ التحميل",
  // Navigation added later
  "Orphaned Photos": "الصور اليتيمة",
  // Page headings of the main lists
  "ITP Register": "سجل خطط الفحص والاختبار",
  "NCR Register": "سجل عدم المطابقة",
  "Observation Register": "سجل الملاحظات",
  "Handover Portal": "بوابة التسليم",
  // Dashboard KPI headings
  "Open NCRs": "تقارير عدم المطابقة المفتوحة",
  "Library proposals": "مقترحات المكتبة",
  "Inspections in progress": "عمليات الفحص الجارية",
  "Active projects": "المشاريع النشطة",
  "Active ITPs": "خطط الفحص النشطة",
  "Recent activity": "النشاط الأخير",
  "Overdue hold points": "نقاط التوقف المتأخرة",
  "Needs your attention": "يحتاج إلى انتباهك",
  // Table column headings
  "Project No.": "رقم المشروع",
  Name: "الاسم",
  Client: "العميل",
  Location: "الموقع",
  Status: "الحالة",
  "ITP Completion": "اكتمال خطة الفحص",
  "Open punch": "بنود القائمة المفتوحة",
  "Overdue holds": "نقاط التوقف المتأخرة",
  "Target end": "تاريخ الانتهاء المستهدف",
  "ITP No.": "رقم خطة الفحص",
  Title: "العنوان",
  Project: "المشروع",
  Rev: "المراجعة",
  "% signed": "نسبة التوقيع",
  Phase: "المرحلة",
  "Record No.": "رقم السجل",
  "ITP / Activity": "خطة الفحص / النشاط",
  Date: "التاريخ",
  Inspector: "المفتش",
  Result: "النتيجة",
  IRN: "طلب الفحص",
  Severity: "الخطورة",
  Description: "الوصف",
  Discipline: "التخصص",
  Due: "الاستحقاق",
};

const DICTIONARIES: Partial<Record<SupportedLocale, Record<string, string>>> = { ar: AR };

/** The display text for `text` in `locale`; the English original when there is no translation. */
export function translateText(locale: SupportedLocale, text: string): string {
  return DICTIONARIES[locale]?.[text] ?? text;
}

interface NavLike {
  label: string;
  group?: string;
  displayLabel?: string;
  displayGroup?: string;
  children?: NavLike[];
  palette?: NavLike[];
}

/** Adds displayLabel / displayGroup to a navigation tree (labels stay English for icons and storage keys). */
export function localizeNavItems<T extends NavLike>(items: T[], locale: SupportedLocale): T[] {
  if (!DICTIONARIES[locale]) return items;
  return items.map((item) => {
    const next: T = { ...item, displayLabel: translateText(locale, item.label) };
    if (item.group) next.displayGroup = translateText(locale, item.group);
    if (item.children) next.children = localizeNavItems(item.children as T[], locale) as T["children"];
    if (item.palette) next.palette = localizeNavItems(item.palette as T[], locale) as T["palette"];
    return next;
  });
}
