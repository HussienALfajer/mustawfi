import type { Locator, Page } from "@playwright/test";
import { issueTestLicense, testLicensePublicKeys } from "@mustawfi/tools-license/testing";
import { e2eStore } from "./environment.ts";
import { runCli } from "./server-cli.ts";
import { addProduct, attachScreens, registerDevice, signIn, tabTo, toasts } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * `core-foundation` slice 21: the store profile with phones typed with a country code and
 * stored in E.164, a large logo reduced on the client, its print mode, and the live receipt
 * preview beside the form; then the POS receipt printing the saved logo. The journey makes its
 * own store, so the run's store keeps no logo.
 */

const PASSWORD = "correct horse battery staple";

async function createStore(): Promise<string> {
  const license = await issueTestLicense({
    expiresAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    limits: { companionDevices: 5 },
  });
  const created = await runCli(
    "src/cli/create-tenant.ts",
    [
      ...["--name", "متجر الشعار", "--base-currency", "SYP"],
      ...["--owner-name", "هالة", "--owner-login", "owner", "--license", license.jws],
    ],
    { DATABASE_URL: e2eStore().databaseUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
    `${PASSWORD}\n`,
  );
  return (JSON.parse(created) as { storeCode: string }).storeCode;
}

/**
 * A logo as a phone photo would come, over the stored limit: 1400 × 700 pixels, its left part
 * black above a flat grey (170) and its right part noise, which no encoder compresses. Drawn by
 * the page's canvas, as PNG bytes.
 */
async function largeLogo(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 700;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no canvas");
    context.fillStyle = "rgb(170, 170, 170)";
    context.fillRect(0, 0, 1100, 700);
    context.fillStyle = "#000";
    context.fillRect(0, 0, 1100, 350);
    const noise = context.createImageData(300, 700);
    for (let i = 0; i < noise.data.length; i += 4) {
      noise.data[i] = Math.floor(Math.random() * 256);
      noise.data[i + 1] = Math.floor(Math.random() * 256);
      noise.data[i + 2] = Math.floor(Math.random() * 256);
      noise.data[i + 3] = 255;
    }
    context.putImageData(noise, 1100, 0);
    const blob = await new Promise<Blob | null>((done) => {
      canvas.toBlob(done, "image/png");
    });
    if (blob === null) throw new Error("no PNG");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/**
 * The share of black dots in two areas of a receipt image, where the logo lands: it is 320 × 160
 * dots (512 × 256 fitted into 360 × 160), centred at x 128 on the 576-dot paper, 8 dots down.
 * Its upper left is the logo's black, its lower left the logo's grey.
 */
async function logoAreas(image: Locator): Promise<{ black: number; grey: number }> {
  return image.evaluate(async (element) => {
    const img = element as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no canvas");
    context.drawImage(img, 0, 0);
    const share = (x: number, y: number, width: number, height: number) => {
      const { data } = context.getImageData(x, y, width, height);
      let black = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 0) black += 1;
      return black / (width * height);
    };
    return { black: share(148, 18, 180, 60), grey: share(148, 108, 180, 50) };
  });
}

/** Whether the calling code in `element` shows its `+` on the left of its digits, as it is written. */
async function plusOnTheLeft(element: Locator): Promise<boolean> {
  return element.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const plus = text.indexOf("+");
      if (plus < 0 || !/[0-9]/.test(text[plus + 1] ?? "")) continue;
      const box = (index: number) => {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().x;
      };
      return box(plus) < box(plus + 1);
    }
    throw new Error("no calling code");
  });
}

test("the store profile: phones with a country code, a reduced logo, and the live receipt", async ({
  page,
}, testInfo) => {
  const storeCode = await createStore();
  await signIn(page, PASSWORD, "owner", storeCode);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await tabTo(page, navigation.getByRole("link", { name: "بيانات المتجر" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/profile$/);

  // Two columns on a wide screen: the receipt beside the form, not below it.
  const preview = page.getByRole("complementary", { name: "معاينة الإيصال" });
  const identity = page.getByRole("region", { name: "هوية المتجر" });
  await expect(preview.getByTestId("profile-receipt-preview")).toBeVisible();
  const [asideBox, formBox] = [await preview.boundingBox(), await identity.boundingBox()];
  expect(asideBox !== null && formBox !== null).toBe(true);
  if (asideBox !== null && formBox !== null) {
    expect(Math.abs(asideBox.y - formBox.y)).toBeLessThan(80);
    // Right to left: the second column is at the left.
    expect(asideBox.x + asideBox.width).toBeLessThanOrEqual(formBox.x);
  }

  // Phones: a national number is read as Syrian and grouped on leaving; one typed with its own
  // code moves the picker to its country; one that is no real number is said on its field.
  const name = page.getByLabel("اسم المتجر (مطلوب)");
  await tabTo(page, name);
  await page.keyboard.press("Enter");
  const first = page.getByLabel("الهاتف 1");
  await expect(first).toBeFocused();
  await page.keyboard.type("0944123456");
  await page.keyboard.press("Enter");
  await expect(first).toHaveValue("0944 123 456");
  const second = page.getByLabel("الهاتف 2");
  await expect(second).toBeFocused();
  await page.keyboard.type("+961 3 123456");
  await page.keyboard.press("Enter");
  await expect(second).toHaveValue("03 123 456");
  const secondCode = page.getByRole("button", { name: /رمز الدولة للهاتف 2/ });
  await expect(secondCode).toContainText("+961");
  // The code reads as it is written, `+` first, inside the Arabic country name.
  expect(await plusOnTheLeft(secondCode)).toBe(true);
  const third = page.getByLabel("الهاتف 3");
  await expect(third).toBeFocused();
  await page.keyboard.type("1234");
  await page.keyboard.press("Control+S");
  await expect(third).toHaveAccessibleDescription(/ليس رقم هاتف صحيحًا في الدولة المختارة/);
  await third.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+S");
  await expect(toasts(page)).toContainText("حُفظت بيانات المتجر");
  const saved = await page.request.get("/api/v1/organization/profile");
  expect((await saved.json()) as unknown).toMatchObject({
    phones: ["+963944123456", "+9613123456"],
    logoPrint: "threshold",
  });

  // A logo over the stored limit is chosen, reduced on the client, and saved at once.
  const logo = await largeLogo(page);
  expect(logo.length).toBeGreaterThan(256 * 1024);
  expect(logo.length).toBeLessThan(5 * 1024 * 1024);
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: logo });
  await expect(toasts(page)).toContainText("حُفظ الشعار الجديد");
  const withLogo = (await (await page.request.get("/api/v1/organization/profile")).json()) as {
    logo: { size: number; type: string } | null;
  };
  expect(withLogo.logo?.size).toBeLessThanOrEqual(256 * 1024);
  expect(withLogo.logo?.type).toBe("image/png");

  // The preview prints it by threshold: the black stays black, the flat grey becomes paper.
  const image = preview.getByTestId("profile-receipt-preview");
  await expect.poll(async () => (await logoAreas(image)).black).toBeGreaterThan(0.95);
  expect((await logoAreas(image)).grey).toBeLessThan(0.02);

  // «صورة» diffuses the grey into dots, in the preview before it is saved.
  const photo = page.getByRole("radio", { name: "صورة" });
  await tabTo(page, page.getByRole("radio", { name: "شعار خطّي" }), 40);
  await page.keyboard.press("ArrowLeft");
  await expect(photo).toBeFocused();
  await page.keyboard.press("Space");
  await expect(photo).toBeChecked();
  await expect.poll(async () => (await logoAreas(image)).grey).toBeGreaterThan(0.2);
  expect((await logoAreas(image)).grey).toBeLessThan(0.5);
  expect((await logoAreas(image)).black).toBeGreaterThan(0.95);
  await page.keyboard.press("Control+S");
  await expect(toasts(page)).toContainText("حُفظت بيانات المتجر");
  // The earlier save's toast may still show: the reload below waits for this save itself
  // (a flake found in QA slice 23).
  await expect
    .poll(async () => {
      const profile = await page.request.get("/api/v1/organization/profile");
      return ((await profile.json()) as { logoPrint: string }).logoPrint;
    })
    .toBe("dither");
  await attachScreens(page, testInfo, "store-profile-receipt");

  // On a narrow screen the preview moves below the form.
  await page.setViewportSize({ width: 900, height: 900 });
  const legal = page.getByRole("region", { name: "البيانات الرسمية" });
  const [below, above] = [await preview.boundingBox(), await legal.boundingBox()];
  if (below === null || above === null) throw new Error("no layout");
  expect(below.y).toBeGreaterThan(above.y + above.height);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole("radio", { name: "صورة" })).toBeChecked();
  await expect(page.getByLabel("الهاتف 2")).toHaveValue("03 123 456");
  await expectAccessible(page);

  // The device fetches the logo after its sync round and prints it on the next receipt.
  await addProduct(page, "شاحن", "6280000210021", "15000");
  const prefix = await registerDevice(page, storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await page.getByRole("button", { name: "أضف شاحن إلى السلة" }).click();
  await page.getByRole("button", { name: "إتمام البيع نقدًا" }).click();
  const number = `${prefix}-INV-000001`;
  await expect(page.getByTestId("recorded-number")).toHaveText(number);
  const cart = page.getByRole("region", { name: "السلة" });
  await cart.getByRole("button", { name: `معاينة إيصال الفاتورة ${number}` }).click();
  const receipt = cart.getByRole("img", { name: `إيصال الفاتورة ${number}` });
  await expect(receipt).toBeVisible();
  const printed = await logoAreas(receipt);
  expect(printed.black).toBeGreaterThan(0.95);
  expect(printed.grey).toBeGreaterThan(0.2);
  expect(printed.grey).toBeLessThan(0.5);
  await testInfo.attach("receipt-with-logo.png", {
    body: Buffer.from(
      ((await receipt.getAttribute("src")) ?? "").replace(/^data:image\/png;base64,/, ""),
      "base64",
    ),
    contentType: "image/png",
  });
});
