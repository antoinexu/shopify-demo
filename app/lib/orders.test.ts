import { describe, expect, it } from "vitest";
import { validateCheckout } from "./orders.server";

/**
 * Checkout validation is the only thing standing between a customer and an
 * undeliverable order, and it runs on the server precisely because the client
 * can be bypassed. Each field gets both a passing and a failing case.
 */

const VALID = {
  name: "Jane Doe",
  phone: "(415) 555-0142",
  email: "jane@example.com",
  state: "CA",
  city: "San Francisco",
  address: "500 Howard St Apt 4",
  zip: "94103",
  note: "",
  shipping: "standard",
};

function validate(overrides: Partial<Record<keyof typeof VALID, string>> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    form.set(key, value);
  }
  return validateCheckout(form);
}

describe("a complete, valid submission", () => {
  it("produces no errors", () => {
    expect(validate().errors).toEqual({});
  });

  it("trims surrounding whitespace off every field", () => {
    const { address } = validate({ name: "  Jane Doe  ", city: "  San Francisco " });
    expect(address.name).toBe("Jane Doe");
    expect(address.city).toBe("San Francisco");
  });
});

describe("phone", () => {
  it.each([
    ["(415) 555-0142", "parenthesised area code"],
    ["415-555-0142", "dashes"],
    ["4155550142", "bare digits"],
    ["+1 415 555 0142", "country code"],
    ["1 (415) 555-0142", "leading 1"],
  ])("accepts %s (%s)", (phone) => {
    expect(validate({ phone }).errors.phone).toBeUndefined();
  });

  it.each([
    ["415555014", "too short"],
    ["41555501422", "too long"],
    ["115-555-0142", "area code starts with 1"],
    ["015-555-0142", "area code starts with 0"],
    ["415-055-0142", "exchange code starts with 0"],
    ["", "empty"],
    ["not a phone", "letters"],
  ])("rejects %s (%s)", (phone) => {
    expect(validate({ phone }).errors.phone).toBeDefined();
  });
});

describe("zip", () => {
  it.each(["94103", "94103-1234"])("accepts %s", (zip) => {
    expect(validate({ zip }).errors.zip).toBeUndefined();
  });

  it.each([
    ["9410", "four digits"],
    ["941030", "six digits"],
    ["94103-12", "short +4"],
    ["SW1A 1AA", "not a US format"],
    ["", "empty — ZIP is required for US shipping"],
  ])("rejects %s (%s)", (zip) => {
    expect(validate({ zip }).errors.zip).toBeDefined();
  });
});

describe("state", () => {
  it.each(["CA", "NY", "DC", "WY"])("accepts %s", (state) => {
    expect(validate({ state }).errors.state).toBeUndefined();
  });

  it.each([
    ["", "empty"],
    ["XX", "not a state"],
    ["California", "full name instead of the code"],
    ["ca", "lowercase"],
  ])("rejects %s (%s)", (state) => {
    expect(validate({ state }).errors.state).toBeDefined();
  });
});

describe("email", () => {
  it.each(["jane@example.com", "jane.doe+tag@sub.example.co.uk"])("accepts %s", (email) => {
    expect(validate({ email }).errors.email).toBeUndefined();
  });

  it.each(["jane", "jane@", "@example.com", "jane@example", "jane doe@example.com", ""])(
    "rejects %s",
    (email) => {
      expect(validate({ email }).errors.email).toBeDefined();
    },
  );
});

describe("name, city and street address", () => {
  it("requires at least two characters of name", () => {
    expect(validate({ name: "J" }).errors.name).toBeDefined();
    expect(validate({ name: "Jo" }).errors.name).toBeUndefined();
  });

  it("requires at least two characters of city", () => {
    expect(validate({ city: "S" }).errors.city).toBeDefined();
  });

  it("requires a street address long enough to be real", () => {
    expect(validate({ address: "1 St" }).errors.address).toBeDefined();
    expect(validate({ address: "500 Howard St" }).errors.address).toBeUndefined();
  });

  it("leaves the note optional", () => {
    expect(validate({ note: "" }).errors).toEqual({});
  });
});

describe("shipping method", () => {
  it("resolves a known id", () => {
    expect(validate({ shipping: "express" }).shipping.id).toBe("express");
  });

  it("flags an unrecognised id rather than quietly charging standard", () => {
    const { errors, shipping } = validate({ shipping: "teleport" });
    expect(errors.shipping).toBeDefined();
    expect(shipping.id).toBe("standard");
  });

  it("defaults to standard when the field is absent, since the form preselects it", () => {
    const { errors, shipping } = validate({ shipping: "" });
    expect(errors.shipping).toBeUndefined();
    expect(shipping.id).toBe("standard");
  });
});

describe("multiple failures", () => {
  it("reports every bad field at once instead of one per round trip", () => {
    const { errors } = validate({ name: "", phone: "1", email: "nope", state: "", zip: "" });
    expect(Object.keys(errors).sort()).toEqual(["email", "name", "phone", "state", "zip"]);
  });
});
