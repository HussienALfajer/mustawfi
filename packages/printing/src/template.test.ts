import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template.ts";

describe("renderTemplate", () => {
  it("fills variables and loops", () => {
    const html = renderTemplate(
      "<h1>{{ store.name }}</h1>{% for line in lines %}<p>{{ line.name }} × {{ line.quantity }}</p>{% endfor %}",
      { store: { name: "متجر الأمل" }, lines: [{ name: "شاحن", quantity: "2" }] },
    );
    expect(html).toBe("<h1>متجر الأمل</h1><p>شاحن × 2</p>");
  });

  it("escapes every output, so data cannot inject markup", () => {
    const html = renderTemplate("<p>{{ name }}</p>", { name: '<img src=x onerror="alert(1)">' });
    expect(html).toBe("<p>&lt;img src=x onerror=&#34;alert(1)&#34;&gt;</p>");
  });

  it("refuses unknown variables and filters instead of printing blanks", () => {
    expect(() => renderTemplate("{{ customer.nmae }}", { customer: { name: "x" } })).toThrow();
    expect(() => renderTemplate("{{ total | shout }}", { total: "1" })).toThrow();
  });

  it("reads only own properties", () => {
    expect(() => renderTemplate("{{ line.constructor }}", { line: {} })).toThrow();
  });

  it("cannot read files", () => {
    expect(() => renderTemplate('{% include "package.json" %}', {})).toThrow();
    expect(() => renderTemplate('{% render "/etc/hosts" %}', {})).toThrow();
  });

  it("bounds the cost of a template", () => {
    expect(() => renderTemplate("{% for i in (1..100000000) %}{{ i }}{% endfor %}", {})).toThrow();
  });
});
