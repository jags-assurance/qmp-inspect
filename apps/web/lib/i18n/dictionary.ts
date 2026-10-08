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
  // Sign-in page
  "Sign in": "تسجيل الدخول",
  "Signing in…": "جارٍ تسجيل الدخول…",
  "Controlled quality. Assured outcomes. Sign in to the Quality Management Platform.":
    "جودة مضبوطة ونتائج مؤكدة. سجّل الدخول إلى منصة إدارة الجودة.",
  "Use your JAGS Assurance account credentials.": "استخدم بيانات حسابك في جاغز للتأكيد.",
  Email: "البريد الإلكتروني",
  Password: "كلمة المرور",
  "Forgot password?": "هل نسيت كلمة المرور؟",
  "Show password": "إظهار كلمة المرور",
  "Hide password": "إخفاء كلمة المرور",
  "If you keep having trouble, use Forgot password or contact your administrator.":
    "إذا استمرت المشكلة، استخدم خيار نسيت كلمة المرور أو تواصل مع مسؤول النظام.",
  "That password reset link is invalid or has expired. Request a new one from Forgot password.":
    "رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً من خيار نسيت كلمة المرور.",
  "This account has been deactivated. Contact your administrator if you think that is a mistake.":
    "تم إيقاف هذا الحساب. تواصل مع مسؤول النظام إذا كنت تعتقد أن ذلك خطأ.",
  "You were signed out after a period of inactivity. Sign in again to continue.":
    "تم تسجيل خروجك بعد فترة من عدم النشاط. سجّل الدخول مرة أخرى للمتابعة.",
  "Your session reached its maximum length. Sign in again to continue.":
    "بلغت جلستك الحد الأقصى لمدتها. سجّل الدخول مرة أخرى للمتابعة.",
  "Your temporary password has expired. Ask your administrator to issue a new one.":
    "انتهت صلاحية كلمة المرور المؤقتة. اطلب من مسؤول النظام إصدار كلمة جديدة.",
  "Your session has ended. Sign in again to continue.": "انتهت جلستك. سجّل الدخول مرة أخرى للمتابعة.",
  // Common status labels and actions
  Approve: "اعتماد",
  Reject: "رفض",
  Approved: "معتمد",
  Rejected: "مرفوض",
  Pending: "قيد الانتظار",
  Draft: "مسودة",
  Active: "نشط",
  Completed: "مكتمل",
  Cancelled: "ملغى",
  "On hold": "معلّق",
  "In progress": "قيد التنفيذ",
  Passed: "مجتاز",
  Failed: "غير مجتاز",
  Create: "إنشاء",
  Next: "التالي",
  Prev: "السابق",
  Page: "صفحة",
  of: "من",
  "See all": "عرض الكل",
  "Open only": "المفتوحة فقط",
  All: "الكل",
  // Projects list
  "+ New project": "+ مشروع جديد",
  "Create project": "إنشاء مشروع",
  "No projects yet.": "لا توجد مشاريع بعد.",
  "No projects to show.": "لا توجد مشاريع للعرض.",
  "Search projects…": "بحث في المشاريع…",
  "Every project across every client you have access to.": "جميع المشاريع لدى جميع العملاء التي لديك صلاحية الوصول إليها.",
  "Projects your organisation is engaged on.": "المشاريع التي تعمل عليها مؤسستك.",
  // Dashboard headings and empty states
  "Inspector Dashboard": "لوحة المفتش",
  "JAGS Admin Overview": "نظرة عامة للمسؤول",
  "NCRs assigned to me": "تقارير عدم المطابقة المسندة إليّ",
  "My pending actions": "إجراءاتي المعلّقة",
  "Your organisation at a glance": "نظرة سريعة على مؤسستك",
  "ITPs awaiting your acceptance": "خطط فحص بانتظار قبولك",
  "NCRs assigned to you": "تقارير عدم المطابقة المسندة إليك",
  "Punch items assigned to you": "بنود قائمة الملاحظات المسندة إليك",
  "Work awaiting your review": "أعمال بانتظار مراجعتك",
  "Awaiting your sign-off": "بانتظار توقيعك",
  "Your organisations": "مؤسساتك",
  "Master Library proposals awaiting review": "مقترحات المكتبة الرئيسية بانتظار المراجعة",
  "No open NCRs.": "لا توجد تقارير عدم مطابقة مفتوحة.",
  "No overdue hold points.": "لا توجد نقاط توقف متأخرة.",
  "No recent activity.": "لا يوجد نشاط حديث.",
  "Nothing to show yet.": "لا يوجد ما يُعرض بعد.",
  "No pending proposals.": "لا توجد مقترحات معلّقة.",
  "Nothing awaiting your acceptance.": "لا شيء بانتظار قبولك.",
  "No observations raised yet.": "لم تُرفع أي ملاحظات بعد.",
  "No inspections match these filters.": "لا توجد عمليات فحص تطابق عوامل التصفية هذه.",
  "No NCRs match these filters. Clear the filters to see the full register.":
    "لا توجد تقارير عدم مطابقة تطابق عوامل التصفية. امسح التصفية لعرض السجل كاملاً.",
  "No NCRs raised yet. Use + Raise NCR to record the first one.":
    "لم تُرفع أي تقارير عدم مطابقة بعد. استخدم «+ رفع تقرير» لتسجيل أول تقرير.",
  "No ITPs yet.": "لا توجد خطط فحص بعد.",
  "No ITPs match your search.": "لا توجد خطط فحص تطابق بحثك.",
  "Nothing waiting. Start a new inspection from Start work, or review Inspections.":
    "لا شيء بانتظار الإجراء. ابدأ فحصاً جديداً من «بدء العمل» أو راجع عمليات الفحص.",
  "You are all caught up. Check Reports & documents below, or open Inspections to follow progress.":
    "لا توجد مهام متبقية. راجع التقارير والمستندات أدناه أو افتح عمليات الفحص لمتابعة التقدم.",
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
  // Forms, lists and dialogs (added with the RTL pass; native-speaker review still needed)
  "Due date": "تاريخ الاستحقاق",
  Priority: "الأولوية",
  "Responsible party": "الجهة المسؤولة",
  "Party type": "نوع الجهة",
  "Organisation / company name": "اسم المؤسسة / الشركة",
  "Contact name": "اسم جهة الاتصال",
  "Contact email": "البريد الإلكتروني لجهة الاتصال",
  "Project number": "رقم المشروع",
  "Project name": "اسم المشروع",
  "Site location": "موقع العمل",
  "Country (optional)": "الدولة (اختياري)",
  "Contract number (optional)": "رقم العقد (اختياري)",
  "Start date (optional)": "تاريخ البدء (اختياري)",
  "End date (optional)": "تاريخ الانتهاء (اختياري)",
  "Requirement not met": "المتطلب غير المستوفى",
  "Scope (optional)": "النطاق (اختياري)",
  "Applicable standard": "المعيار المطبق",
  "ITP number": "رقم خطة الفحص والاختبار",
  "Select…": "اختر…",
  Required: "مطلوب",
  Optional: "اختياري",
  Print: "طباعة",
  Export: "تصدير",
  "Export all": "تصدير الكل",
  Filter: "تصفية",
  Clear: "مسح",
  Add: "إضافة",
  Remove: "إزالة",
  Retry: "إعادة المحاولة",
  Details: "التفاصيل",
  Notes: "ملاحظات",
  Photos: "الصور",
  Documents: "المستندات",
  "Punch list": "قائمة الملاحظات",
  "Punch list items": "بنود قائمة الملاحظات",
  "Add punch item": "إضافة بند إلى قائمة الملاحظات",
  "Raise NCR": "رفع تقرير عدم مطابقة",
  "+ Raise NCR": "+ رفع تقرير عدم مطابقة",
  "New NCR": "تقرير عدم مطابقة جديد",
  "New ITP": "خطة فحص جديدة",
  "Add party": "إضافة جهة",
  "Mark as read": "تعليم كمقروء",
  "Select a project.": "اختر مشروعاً.",
  "Select a severity.": "اختر درجة الخطورة.",
  "Enter your email.": "أدخل بريدك الإلكتروني.",
  "Enter your password.": "أدخل كلمة المرور.",
  "Enter your email and password.": "أدخل بريدك الإلكتروني وكلمة المرور.",
  "Invalid email or password.": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "Change sign-off level": "تغيير مستوى التوقيع",
  "Change level": "تغيير المستوى",
  "Reason for this change": "سبب هذا التغيير",
  "Export failed": "فشل التصدير",
  OK: "موافق",
  Offline: "غير متصل",
  "Sync now": "مزامنة الآن",
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
