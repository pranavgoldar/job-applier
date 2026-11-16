// Career OS form filler. Runs inside an application page in your own browser.
// It fills what it recognises, attaches your resume, lists what is left for you,
// and never presses Submit.
(() => {
  const YES = /^\s*yes\b/i,
    NO = /^\s*no\b/i;
  // Each rule: which saved value answers which kind of question.
  // `q` is tested against the question text, `n` against the field's name or id.
  const RULES = [
    { key: "firstName", q: /first name|given name/, n: /^first[_-]?name$/ },
    {
      key: "lastName",
      q: /last name|surname|family name/,
      n: /^last[_-]?name$/,
    },
    { key: "email", q: /e-?mail/, n: /^email/, type: "email" },
    {
      key: "phone",
      q: /phone|mobile|contact number/,
      n: /^phone/,
      type: "tel",
    },
    { key: "linkedin", q: /linkedin/, n: /linkedin/ },
    { key: "github", q: /github/, n: /github/ },
    {
      key: "portfolio",
      q: /portfolio|personal (web)?site|other website|your website/,
      n: /portfolio|urls\[other\]/,
    },
    {
      key: "currentCtc",
      q: /current (fixed )?(ctc|salary|compensation)|present (ctc|salary)/,
    },
    {
      key: "expectedCtc",
      q: /expect(ed|ation)s?.{0,20}(ctc|salary|compensation)|(ctc|salary|compensation) expect/,
    },
    { key: "noticePeriod", q: /notice period/ },
    {
      key: "experienceYears",
      q: /(years|yrs) of (relevant |work |professional |total )?experience|total (years of )?(work )?experience|experience in (number of )?years/,
    },
    {
      key: "relativeAtCompany",
      q: /relative|family member/,
      yesno: true,
    },
    {
      key: "previouslyEmployed",
      q: /previously (been )?(employed|worked|engaged)|worked (at|for|with) .{0,40} before|former(ly)? (an? )?employe/,
      yesno: true,
    },
    {
      key: "backgroundCheck",
      q: /background (verification|check|screening)/,
      yesno: true,
    },
    {
      key: "sponsorship",
      q: /sponsorship|require.{0,30}visa|visa.{0,30}require/,
      yesno: true,
    },
    {
      key: "workAuthorization",
      q: /authori[sz]ed to work|legally (authori[sz]ed|eligible|permitted)|work authori[sz]ation|right to work|eligible to work/,
      yesno: true,
    },
    { key: "relocate", q: /relocat/, yesno: true },
    {
      key: "availability",
      q: /when can you (join|start)|how soon can you (join|start)|earliest (start|joining)|available to (join|start)|joining date|start date\b(?! (month|year))/,
    },
    { key: "howHeard", q: /how did you (hear|find|learn|come)/ },
    {
      key: "graduationYear",
      q: /graduat(ion|ing|e) (year|date)|year of (graduation|passing)|passing year/,
    },
    { key: "degree", q: /\bdegree\b|highest qualification/ },
    {
      key: "college",
      q: /college|university|school name|institut(e|ion)/,
      n: /^school/,
    },
    {
      key: "currentCompany",
      q: /current (company|employer|organi[sz]ation)|company name|present (company|employer)/,
      n: /^org$|^company[_-]?name/,
    },
    {
      key: "currentTitle",
      q: /current (job )?(title|role|designation)|^title$/,
      n: /^title(-\d+)?$/,
    },
    { key: "country", q: /^country/, n: /^country$/ },
    {
      key: "city",
      q: /current (location|city)|location \(city\)|^(city|location)$|where are you (currently )?(based|located)|city of residence/,
      n: /^location$|candidate-location|^city$/,
    },
    { key: "fullName", q: /^(full |your )?name$|full name/, n: /^name$/ },
  ];
  const clean = (s) =>
    String(s || "")
      .replace(/[*✱]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  function values(data) {
    const p = data.profile || {},
      a = data.answers || {},
      parts = clean(p.name).split(" ").filter(Boolean);
    return {
      ...a,
      fullName: clean(p.name),
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" "),
      email: p.email || "",
      phone: p.phone || "",
      city: a.city || "",
      country: a.country || "",
      college: a.college || p.education || "",
      graduationYear: a.graduationYear || (p.graduation || "").slice(0, 4),
    };
  }
  const visible = (el) => {
    if (el.type === "hidden" || el.disabled) return false;
    const view = el.ownerDocument.defaultView;
    if (!view?.getComputedStyle) return true;
    const s = view.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  };
  const GROUP =
    ".application-question, .field-wrapper, fieldset, [role=group], [role=radiogroup], .ashby-application-form-field-entry, [class*=fieldEntry], .form-group, .field, li";
  const HEADS = [
    ".application-label",
    "legend",
    ".label",
    "[class*=question-label], [class*=questionLabel], [class*=Label]",
    ".text",
    "h3, h4",
    "label",
    "p",
  ];
  // The first heading-like element inside `box` that is not one of the options.
  function heading(box, controls) {
    for (const selector of HEADS)
      for (const node of box.querySelectorAll(selector))
        if (
          clean(node.textContent) &&
          !controls.some((c) => node.contains(c) || c.contains(node)) &&
          !node.closest("[role=option], [role=listbox]")
        )
          return clean(node.textContent);
    return "";
  }
  // The question a control (or a group of radio buttons) belongs to, as a person would read it.
  function questionOf(el, group = [el]) {
    const doc = el.ownerDocument,
      choice = el.type === "radio" || el.type === "checkbox";
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/);
    for (const id of ids) {
      const t = id && clean(doc.getElementById(id)?.textContent);
      if (t && !choice) return t;
    }
    if (!choice) {
      const direct =
        el.id && doc.querySelector(`label[for="${CSS_escape(el.id)}"]`);
      if (direct && clean(direct.textContent))
        return clean(
          direct.querySelector(".application-label")?.textContent ||
            direct.textContent,
        );
    }
    // Climb until a container holds every option plus a heading for them.
    let box = el.parentElement;
    for (let depth = 0; box && depth < 7; depth++, box = box.parentElement) {
      if (box.tagName === "FORM" || box.tagName === "BODY") break;
      if (!group.every((c) => box.contains(c))) continue;
      const text = heading(box, group);
      if (text) return text.slice(0, 300);
    }
    return clean(
      el.getAttribute("aria-label") || el.getAttribute("placeholder"),
    );
  }
  const CSS_escape = (s) =>
    globalThis.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  function optionText(el) {
    const doc = el.ownerDocument;
    return clean(
      (el.id && doc.querySelector(`label[for="${CSS_escape(el.id)}"]`))
        ?.textContent ||
        el.closest("label")?.textContent ||
        el.value,
    );
  }
  function ruleFor(el, question) {
    const q = question.toLowerCase(),
      n = (el.getAttribute("name") || el.id || "").toLowerCase();
    return RULES.find(
      (r) =>
        (r.type && el.type === r.type) ||
        (r.n && r.n.test(n)) ||
        (r.q && r.q.test(q)),
    );
  }
  function setValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? el.ownerDocument.defaultView.HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? el.ownerDocument.defaultView.HTMLSelectElement.prototype
          : el.ownerDocument.defaultView.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    const View = el.ownerDocument.defaultView;
    el.dispatchEvent(new View.Event("input", { bubbles: true }));
    el.dispatchEvent(new View.Event("change", { bubbles: true }));
  }
  const matches = (text, value) => {
    const t = clean(text).toLowerCase(),
      v = clean(value).toLowerCase();
    if (!t || !v) return false;
    if (YES.test(v)) return YES.test(t);
    if (NO.test(v)) return NO.test(t);
    return t === v || t.startsWith(v) || v.startsWith(t);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Dropdowns built with react-select (Greenhouse): open the list, pick the option.
  // A full mouse press (down, up, click) is what these lists respond to.
  async function pickCombobox(el, value) {
    const View = el.ownerDocument.defaultView,
      press = (node) => {
        for (const type of ["mousedown", "mouseup", "click"])
          node.dispatchEvent(
            new View.MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              button: 0,
              view: View,
            }),
          );
      },
      control = el.closest('[class*="control"]') || el.parentElement,
      shell = el.closest(".select-shell") || control.parentElement,
      chosen = () =>
        control.querySelector(
          '[class*="single-value"], [class*="multi-value"]',
        );
    if (chosen()) return "kept";
    const options = () => {
      const list = el.getAttribute("aria-controls"),
        root =
          (list && el.ownerDocument.getElementById(list)) ||
          shell.querySelector('[class*="menu"]');
      return root ? [...root.querySelectorAll('[role="option"]')] : [];
    };
    const find = async (tries) => {
      for (let i = 0; i < tries; i++) {
        const hit = options().find((o) => matches(o.textContent, value));
        if (hit) return hit;
        await sleep(120);
      }
    };
    press(control);
    let option = await find(8);
    if (!option) {
      // Long or searched lists (country, city): type to narrow them down.
      setValue(el, value);
      option = await find(25);
    }
    if (!option) {
      setValue(el, "");
      el.blur();
      return "no-option";
    }
    press(option);
    for (let i = 0; i < 10 && !chosen(); i++) await sleep(60);
    return chosen() ? "filled" : "no-option";
  }
  // When the form has its own country-code picker next to the phone box, enter
  // the number without the code so it is not written twice.
  function localPhone(el, phone) {
    const box = el.closest(
        "fieldset, [class*=phone], .field-wrapper",
      )?.parentElement,
      code = box
        ?.querySelector('[class*="single-value"], .iti__selected-dial-code')
        ?.textContent.match(/\+(\d{1,4})/)?.[1],
      digits = phone.replace(/[^\d+]/g, "");
    return code && digits.startsWith("+" + code)
      ? digits.slice(code.length + 1)
      : phone;
  }
  function attachResume(doc, resume) {
    if (!resume?.base64) return "none";
    const inputs = [...doc.querySelectorAll('input[type="file"]')].filter(
      (i) => !i.disabled,
    );
    const about = (i) =>
      `${i.name} ${i.id} ${questionOf(i)} ${clean(i.closest(GROUP)?.textContent).slice(0, 80)}`.toLowerCase();
    const input =
      inputs.find((i) => /resume|\bcv\b/.test(about(i))) ||
      inputs.find((i) => !/cover|letter|transcript|photo/.test(about(i)));
    if (!input) return "no-field";
    if (input.files?.length) return "kept";
    const View = doc.defaultView,
      bytes = Uint8Array.from(atob(resume.base64), (c) => c.charCodeAt(0)),
      transfer = new View.DataTransfer();
    transfer.items.add(
      new View.File([bytes], resume.name, { type: resume.mime }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new View.Event("input", { bubbles: true }));
    input.dispatchEvent(new View.Event("change", { bubbles: true }));
    return "attached";
  }
  const required = (el) =>
    el.required ||
    el.hasAttribute("required") ||
    el.getAttribute("aria-required") === "true" ||
    /[*✱]\s*$/.test(
      (
        el.closest(GROUP)?.querySelector(".application-label, legend, label")
          ?.textContent || ""
      ).trim(),
    ) ||
    !!el.closest(".required-field");
  // Fill one page. Returns what was filled and what still needs a person.
  async function fill(data, doc = document) {
    const v = values(data),
      filled = [],
      needs = [],
      seen = new Set(),
      note = (list, question, el) => {
        if (!question || seen.has(question)) return;
        seen.add(question);
        list.push({ question, el });
      };
    const resume = attachResume(doc, data.resume);
    const controls = [
      ...doc.querySelectorAll("input, textarea, select"),
    ].filter(
      (el) =>
        visible(el) &&
        !["file", "submit", "button", "hidden", "search"].includes(el.type) &&
        !/captcha/i.test(el.name + el.id),
    );
    const groups = new Map();
    for (const el of controls) {
      if (el.type === "radio" || el.type === "checkbox") {
        const key =
          el.name ||
          el.closest("fieldset, [role=group], [role=radiogroup], ul, div")
            ?.id ||
          questionOf(el);
        groups.set(key, [...(groups.get(key) || []), el]);
        continue;
      }
      const question = questionOf(el),
        rule = ruleFor(el, question),
        value = rule && v[rule.key],
        combo = el.getAttribute("role") === "combobox";
      let done = false;
      if (combo) {
        const state = value ? await pickCombobox(el, value) : "no-value";
        done = state === "filled" || state === "kept";
      } else if (el.value && String(el.value).trim()) done = true;
      else if (value && el.tagName === "SELECT") {
        const option = [...el.options].find((o) =>
          matches(o.textContent, value),
        );
        if (option) {
          setValue(el, option.value);
          done = true;
        }
      } else if (value && !rule.yesno) {
        setValue(el, rule.key === "phone" ? localPhone(el, value) : value);
        done = true;
      }
      if (done) note(filled, question, el);
      else if (required(el, question)) note(needs, question, el);
    }
    for (const [, group] of groups) {
      const question = questionOf(group[0], group),
        rule = ruleFor(group[0], question),
        value = rule && v[rule.key];
      if (group.some((el) => el.checked)) {
        note(filled, question, group[0]);
        continue;
      }
      // Only answer a choice question when a saved answer clearly matches one option.
      const choice =
        value &&
        group[0].type === "radio" &&
        group.find((el) => matches(optionText(el), value));
      if (choice) {
        choice.click();
        note(filled, question, choice);
      } else if (group.some((el) => required(el, question)))
        note(needs, question, group[0]);
    }
    if (resume === "no-field" || resume === "none")
      needs.unshift({
        question:
          resume === "none"
            ? "Resume: none uploaded in Career OS for this kind of role"
            : "Resume: attach it yourself, no upload field was recognised",
        el: null,
      });
    return { filled, needs, resume };
  }
  // True once the employer's page says the application went through.
  function detectSubmitted(doc = document) {
    const text = clean(doc.body?.textContent).slice(0, 6000),
      path = doc.location?.pathname || "";
    const said =
      /thank(s| you) for (applying|your application|your interest)|application (has been |was |is )?(successfully )?(submitted|received|sent)|(we('ve| have)|have) received your application|successfully (applied|submitted)|your application is in/i.test(
        text,
      );
    return (
      /\/(thanks|confirmation|thank-you|success)\b/.test(path) ||
      (said && !doc.querySelector('input[type="file"]'))
    );
  }
  globalThis.CareerOsFill = { fill, detectSubmitted, questionOf, RULES };
})();
