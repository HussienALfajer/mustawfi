# Glossary

The UI speaks Arabic; the code speaks English. Use these identifiers in code, APIs, and docs so one concept always has one name. Add new terms here when a module introduces them.

## Organization and access

| Arabic | English | Code identifier |
|---|---|---|
| حساب الزبون (المتجر المشترك) | Tenant | `tenant` |
| فرع | Branch | `branch` |
| قسم | Department (profit center) | `department` |
| مستخدم | User | `user` |
| دور | Role | `role` |
| صلاحية | Permission | `permission` |
| موافقة المشرف | Supervisor override | `supervisorOverride` |
| جهاز رئيسي (كاشير) | Main POS device (device type `mainPos`) | `mainPosDevice` |
| جهاز مساعد (موبايل) | Mobile companion device (device type `companion`; the browser registers as one) | `companionDevice` |
| لوحة المالك | Owner dashboard | `ownerDashboard` |
| القسم الافتراضي | Default department (seeded with the tenant, hidden while it is the only active one) | `defaultDepartment` |
| نطاق الأقسام | Department scope (all, or listed departments) | `departmentScope` |
| قالب دور | Role template | `roleTemplate` (`owner`, `accountant`, `sectionCashier`, `repairTechnician`, `topUpOperator`) |
| حد صلاحية | Permission limit (percent, amount, or count) | `limit` |
| إجراء (صلاحية) | Action permission | `permission` |
| ملف المتجر | Store profile | `storeProfile` |
| الرقم الضريبي | Tax number | `taxNumber` |
| رقم السجل التجاري | Commercial register number | `commercialRegister` |
| رمز نوع المستند | Document code (three letters, e.g. `INV`) | `docCode` |
| تسلسل مستندات الجهاز | Document sequence (the server's last number per device and document code) | `documentSequence` (`lastSeq`) |
| فجوة في الترقيم | Number gap (numbers a device skipped, flagged and audited) | `numberGap` (`organization.numbering.gap`) |
| قفل تلقائي | Auto-lock | `autoLock` |
| قفل المستخدم على الجهاز | PIN lockout | `pinLockout` |
| إبطال الجهاز | Device revoke | `revoke` (`revokedAt`) |
| مسح بيانات الجهاز | Device wipe | `wipe` |
| التحقق بخطوتين | Two-factor authentication (TOTP) | `twoFactor` |
| رمز استرداد | Recovery code | `recoveryCode` |
| رمز إعادة تعيين (من الدعم) | Support reset code | `resetCode` |

## Accounting

| Arabic | English | Code identifier |
|---|---|---|
| قيد | Journal entry | `journalEntry` |
| سطر قيد | Journal line | `journalLine` |
| دفتر اليومية | Journal | `journal` |
| دفتر الأستاذ | General ledger | `ledger` |
| دليل الحسابات | Chart of accounts | `chartOfAccounts` |
| حساب | Account | `account` |
| حساب نظامي | System account (found by role: cash, sales revenue, rounding differences) | `systemAccount` (`cash`, `salesRevenue`, `roundingDifferences`) |
| ميزان المراجعة | Trial balance | `trialBalance` |
| ترحيل | Posting | `post` / `posting` |
| قيد عكسي | Reversal | `reversal` |
| قفل الفترة | Period lock | `periodLock` |
| أرصدة افتتاحية | Opening balances | `openingBalances` |
| مركز ربح | Profit center | none — a department is the profit center; use `department` |
| أرباح وخسائر | Profit and loss | `profitAndLoss` |

## Currency

| Arabic | English | Code identifier |
|---|---|---|
| العملة الأساسية | Base currency | `baseCurrency` |
| عملة الحساب | Account currency | `accountCurrency` |
| سعر الصرف | Exchange rate | `exchangeRate` |
| فروق الصرف | Exchange differences | `fxDifference` |
| تقريب | Rounding | `rounding` |
| تقريب نقدي | Cash rounding | `cashRounding` |
| حساب فروق التقريب | Rounding differences account | `roundingDifferences` |
| تاريخ العمل | Business date | `businessDate` |
| التاريخ المحاسبي | Accounting date | `accountingDate` |
| صرافة (داخل الصندوق) | Currency exchange | `currencyExchange` |
| الليرة السورية الجديدة | New Syrian pound | `SYP` |
| الليرة القديمة | Old Syrian pound (legacy, ÷100) | `legacySyp` |
| دولار | US dollar | `USD` |

## Treasury

| Arabic | English | Code identifier |
|---|---|---|
| صندوق | Cash box | `cashBox` |
| الصندوق الرئيسي | Main cash box | `mainCashBox` |
| وردية | Shift | `shift` |
| رصيد افتتاحي للوردية | Opening float | `openingFloat` |
| عدّ النقد | Cash count | `cashCount` |
| فرق الوردية (عجز / زيادة) | Shift variance (shortage / overage) | `shiftVariance` |
| تسليم الصندوق | Cash handover | `cashHandover` |
| سند قبض | Receipt voucher | `receiptVoucher` |
| سند دفع | Payment voucher | `paymentVoucher` |
| مصروف | Expense | `expense` |
| تصنيف المصروف | Expense category | `expenseCategory` |
| اشتراك الأمبيرات (المولدة) | Generator subscription | `generatorFee` |
| سلفة موظف | Staff advance | `staffAdvance` |
| مسحوبات شخصية | Owner drawing | `ownerDrawing` |
| وسيلة دفع | Payment method | `paymentMethod` |
| شام كاش / سيريتل كاش / MTN كاش | Sham Cash / Syriatel Cash / MTN Cash | `shamCash` / `syriatelCash` / `mtnCash` |
| بطاقة بيميرا | Bemira card | `bemiraCard` |

## Inventory

| Arabic | English | Code identifier |
|---|---|---|
| مادة | Product | `product` |
| خدمة | Service item | `serviceItem` |
| تصنيف | Category | `category` |
| ماركة | Brand | `brand` |
| وحدة / تحويل وحدات | Unit / unit conversion | `unit` / `unitConversion` |
| كرتونة / علبة / قطعة | Carton / pack / piece | `carton` / `pack` / `piece` |
| مفرّق / نصف جملة / جملة | Retail / half-wholesale / wholesale | `retail` / `halfWholesale` / `wholesale` |
| مستوى السعر | Price level | `priceLevel` |
| التكلفة بالمتوسط المرجّح | Weighted average cost | `weightedAverageCost` |
| حركة مخزون | Stock movement | `stockMovement` |
| الرصيد المتوفر | Stock on hand (a product's stock level) | `onHand` / `stockLevel` |
| موقع مخزون | Stock location | `stockLocation` |
| تسوية مخزون | Stock adjustment | `stockAdjustment` |
| جرد | Stocktake | `stocktake` |
| تحويل مخزون | Stock transfer | `stockTransfer` |
| حد أدنى | Minimum stock | `minStock` |
| ملصق باركود | Barcode label | `barcodeLabel` |

## Sales and purchases

| Arabic | English | Code identifier |
|---|---|---|
| فاتورة مبيع | Sales invoice | `salesInvoice` |
| فاتورة شراء | Purchase invoice | `purchaseInvoice` |
| مرتجع مبيعات / مشتريات | Sales return / purchase return | `salesReturn` / `purchaseReturn` |
| بيع بالدين (آجل) | Credit sale | `creditSale` |
| تعليق فاتورة | Hold invoice | `holdInvoice` |
| تقسيم الدفع | Split payment | `splitPayment` |
| طلب مُرسل إلى الكاشير | Cashier order (sent from mobile) | `cashierOrder` |
| إيصال رقمي | Digital receipt | `digitalReceipt` |
| مورد | Supplier | `supplier` |
| زبون | Customer | `customer` |
| ذمم مدينة (ديون الزبائن) | Receivables | `receivables` |
| ذمم دائنة | Payables | `payables` |
| كشف حساب | Account statement | `statement` |
| حد الدين | Credit limit | `creditLimit` |

## Phone shop pack

| Arabic | English | Code identifier |
|---|---|---|
| رقم تسلسلي | Serial number | `serialNumber` |
| IMEI الأول / الثاني | IMEI 1 / IMEI 2 | `imei1` / `imei2` |
| وحدة متتبَّعة | Serialized unit | `serializedUnit` |
| شراء جهاز مستعمل | Used-device purchase | `tradeIn` |
| ضمان | Warranty | `warranty` |
| بطاقة صيانة | Repair ticket | `repairTicket` |
| عربون | Deposit | `deposit` |
| فني | Technician | `technician` |
| قطعة غيار | Spare part | `sparePart` |
| أجرة يد | Labor | `labor` |
| رمز قفل الجهاز | Device passcode | `devicePasscode` |
| رصيد الشبكة | Carrier balance | `carrierBalance` |
| بيع رصيد (تحويل وحدات) | Top-up sale | `topUpSale` |
| بطاقة تعبئة | Recharge card | `rechargeCard` |
| خدمات الوكالة (إيداع / سحب) | E-wallet agent service (cash-in / cash-out) | `walletAgentService` |
| عمولة | Commission / fee | `commission` |
| مطابقة يومية | Daily reconciliation | `dailyReconciliation` |

## Supermarket pack

| Arabic | English | Code identifier |
|---|---|---|
| مادة موزونة | Weighted item | `weightedItem` |
| باركود الميزان | Scale barcode | `scaleBarcode` |
| رمز PLU | PLU code | `plu` |
| تعديل جماعي للأسعار | Bulk price update | `bulkPriceUpdate` |

## Platform and licensing

| Arabic | English | Code identifier |
|---|---|---|
| خطة / باقة | Plan | `plan` |
| استحقاق | Entitlement | `entitlement` |
| إضافة مدفوعة | Add-on | `addOn` |
| ترخيص | License | `license` |
| حالة الترخيص | License state (`active`, `expiring`, `grace`, `readOnly`, `suspended`) | `licenseState` |
| أقصى أيام بلا اتصال | Maximum offline days | `maxOfflineDays` |
| حارس الساعة | Clock guard (monotonic high-water mark, ADR-0021) | `clockGuard` |
| وقت الخادم الموقّع | Signed server time (the clock guard's trusted server time) | `serverTime` |
| وضع الترخيص | License standing: the state with its expiry, read-only, and suspension dates | `licenseStanding` |
| قيد الترخيص | License restriction: why a device may create no document now | `licenseRestriction` |
| ترخيص دائم | Perpetual license | `perpetualLicense` |
| صيانة سنوية | Annual maintenance | `annualMaintenance` |
| مهلة سماح | Grace period | `gracePeriod` |
| قراءة فقط | Read-only | `readOnly` |
| موقوف | Suspended | `suspended` |
| تمديد مؤقت | Temporary extension | `temporaryExtension` |
| الدخول كزبون | Support impersonation | `impersonation` |
| لوحة السوبر أدمن | Admin console | `adminConsole` |
| وكيل (موزّع) | Reseller | `reseller` |
| حقل مخصص | Custom field | `customField` |
| قالب طباعة | Print template | `printTemplate` |
| إعداد | Setting | `setting` |
| مزامنة | Sync | `sync` |
| طابور الإرسال | Outbox | `outbox` |
| حزمة الإعدادات الموقّعة | Signed configuration bundle | `configBundle` |
| سجل التدقيق | Audit log | `auditLog` |
| صفحات الزبون | Customer portal | `customerPortal` |
| بادئة الجهاز | Device prefix | `devicePrefix` |
| رمز تسجيل الجهاز | Device registration code | `registrationCode` |
| رمز المتجر | Store code (names the tenant at sign-in, ADR-0029) | `storeCode` |
| قيد تدقيق | Audit entry | `auditEntry` |
| اعتماد الجهاز | Device credential | `deviceCredential` |
| رمز PIN | PIN | `pin` |
| جلسة | Session | `session` |
| عملية مزامنة | Sync operation (identified by `opId`) | `SyncOperation` |
| سجل التغييرات | Change log | `changeLog` |
| مؤشر المزامنة | Sync cursor | `syncCursor` |
| بحاجة لمراجعة | Needs review | `needsReview` |
| تنبيه للمحاسب | Accountant flag | `flag` |
| مخزون سالب | Negative stock (flag) | `negativeStock` |
| عدم تطابق حسابي | Arithmetic mismatch (flag) | `arithmeticMismatch` |
| تنبيه على العملية | Operation flag (any document type, `core.sync`) | `operationFlag` (`deviceRevoked`, `licenseReadOnly`, `permissionMissing`, `overrideNotAuthorized`, `numberGap`) |
| قاعدة البيانات المحلية | Local database (ADR-0019) | `localDb` |
| سلة البيع | POS cart | `cart` |
| حالة المزامنة | Sync status (phase, pending, needs review) | `syncStatus` |
