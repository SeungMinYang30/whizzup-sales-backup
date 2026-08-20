export type InstitutionContact = {
  role: string;
  name: string;
  phone: string;
  email: string;
  primary: boolean;
};

function text(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function emptyInstitutionContact(primary = false): InstitutionContact {
  return { role: "", name: "", phone: "", email: "", primary };
}

export function normalizeInstitutionContacts(
  value: unknown,
  legacy?: Partial<InstitutionContact>,
) {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = [];
    }
  }
  const contacts = (Array.isArray(raw) ? raw : [])
    .slice(0, 20)
    .map((item) => {
      const source =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        role: text(source.role, 120),
        name: text(source.name, 120),
        phone: text(source.phone, 120),
        email: text(source.email, 320),
        primary: source.primary === true,
      };
    })
    .filter((contact) =>
      Boolean(contact.role || contact.name || contact.phone || contact.email),
    );

  if (!contacts.length && legacy) {
    const fallback = {
      role: text(legacy.role, 120),
      name: text(legacy.name, 120),
      phone: text(legacy.phone, 120),
      email: text(legacy.email, 320),
      primary: true,
    };
    if (fallback.role || fallback.name || fallback.phone || fallback.email) {
      contacts.push(fallback);
    }
  }

  const primaryIndex = Math.max(
    0,
    contacts.findIndex((contact) => contact.primary),
  );
  return contacts.map((contact, index) => ({
    ...contact,
    primary: index === primaryIndex,
  }));
}

export function primaryInstitutionContact(
  contacts: InstitutionContact[],
  legacy?: Partial<InstitutionContact>,
) {
  return (
    contacts.find((contact) => contact.primary) ??
    contacts[0] ?? {
      role: text(legacy?.role, 120),
      name: text(legacy?.name, 120),
      phone: text(legacy?.phone, 120),
      email: text(legacy?.email, 320),
      primary: true,
    }
  );
}

export function serializeInstitutionContacts(
  value: unknown,
  legacy?: Partial<InstitutionContact>,
) {
  return JSON.stringify(normalizeInstitutionContacts(value, legacy));
}
