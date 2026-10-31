import "dotenv/config";
import { ALL_PERMISSIONS } from "../lib/permissions.js";
import type {
  ApprovalStep,
  AuditLog,
  Department,
  Employee,
  Hardware,
  LeaveRequest,
  PurchaseRequest,
  Role,
  Ticket,
  TicketComment,
  User,
} from "../lib/types.js";
import type { HardwareType, LeaveType, TicketCategory, TicketPriority, TicketStatus } from "../lib/enums.js";
import { toISODate } from "../lib/format.js";
import { pool } from "./pool.js";
import { type TableName, type Tables, insert, newId, transaction } from "./tables.js";
import { hashPassword } from "../domain/password.js";
import { resolveHeadApprover } from "../domain/org.js";

// Deterministic PRNG so every reset produces the same organisation.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261031);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");

const NOW = new Date();
const daysAgo = (n: number, h = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(h, int(0, 59), 0, 0);
  return d;
};
const dateOffset = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
const iso = (d: Date) => d.toISOString();

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const translit = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("");

const MALE_FIRST = ["Александр", "Андрей", "Сергей", "Дмитрий", "Николай", "Владимир", "Игорь", "Олег", "Павел", "Максим", "Евгений", "Виталий", "Юрий", "Артём", "Роман", "Денис", "Илья", "Кирилл"];
const FEMALE_FIRST = ["Анна", "Елена", "Ольга", "Татьяна", "Наталья", "Ирина", "Светлана", "Марина", "Юлия", "Екатерина", "Дарья", "Алина", "Виктория", "Людмила"];
const MALE_MIDDLE = ["Александрович", "Сергеевич", "Николаевич", "Владимирович", "Игоревич", "Петрович", "Иванович", "Викторович", "Михайлович", "Анатольевич"];
const FEMALE_MIDDLE = ["Александровна", "Сергеевна", "Николаевна", "Владимировна", "Игоревна", "Петровна", "Ивановна", "Викторовна", "Михайловна", "Анатольевна"];
const SURNAMES: [string, string][] = [
  ["Ковалёв", "Ковалёва"], ["Шевченко", "Шевченко"], ["Бондаренко", "Бондаренко"], ["Ткачук", "Ткачук"], ["Романович", "Романович"],
  ["Лисовский", "Лисовская"], ["Гурин", "Гурина"], ["Карпович", "Карпович"], ["Михалевич", "Михалевич"], ["Сидорович", "Сидорович"],
  ["Зайцев", "Зайцева"], ["Петрашевич", "Петрашевич"], ["Воронович", "Воронович"], ["Лапицкий", "Лапицкая"], ["Козлов", "Козлова"],
  ["Ярошевич", "Ярошевич"], ["Макаревич", "Макаревич"], ["Демидович", "Демидович"], ["Тарасевич", "Тарасевич"], ["Кузьмич", "Кузьмич"],
  ["Белоус", "Белоус"], ["Жук", "Жук"], ["Рябцев", "Рябцева"], ["Пашкевич", "Пашкевич"], ["Мороз", "Мороз"], ["Василевский", "Василевская"],
  ["Горбачёв", "Горбачёва"], ["Дорошенко", "Дорошенко"], ["Сахаров", "Сахарова"], ["Юркевич", "Юркевич"],
];
const STREETS = ["ул. Советская", "ул. Ленина", "пр-т Речицкий", "ул. Рогачёвская", "ул. Кирова", "ул. Пушкина", "ул. Интернациональная", "ул. Молодёжная", "ул. Строителей", "ул. Нефтяников", "мкр. Юбилейный", "ул. Мазурова"];
const BANKS = [
  { bankName: "ОАО «АСБ Беларусбанк»", bic: "AKBBBY2X", code: "AKBB" },
  { bankName: "ОАО «Белагропромбанк»", bic: "BAPBBY2X", code: "BAPB" },
  { bankName: "ОАО «Приорбанк»", bic: "PJCBBY2X", code: "PJCB" },
  { bankName: "ОАО «БНБ-Банк»", bic: "BLNBBY2X", code: "BLNB" },
];
const POSTAL: Record<string, string> = { Гомель: "246", Речица: "247", Светлогорск: "247", Минск: "220" };

interface DeptSeed {
  key: string;
  code: string;
  name: string;
  shortName: string;
  parent: string | null;
  city: string;
  description: string;
  head: string;
  positions: string[];
  size: number;
}

const DEPARTMENTS: DeptSeed[] = [
  { key: "hq", code: "BN-000", name: "Генеральная дирекция", shortName: "ГД", parent: null, city: "Гомель", description: "Государственное производственное объединение «Белоруснефть», центральный аппарат (г. Гомель, ул. Рогачёвская, 9)", head: "Генеральный директор", positions: ["Заместитель генерального директора", "Помощник генерального директора", "Главный инженер"], size: 3 },
  { key: "hr", code: "BN-100", name: "Управление по работе с персоналом", shortName: "УРП", parent: "hq", city: "Гомель", description: "Кадровое администрирование, подбор и развитие персонала", head: "Начальник управления по работе с персоналом", positions: ["Ведущий специалист по кадрам", "Специалист по кадрам", "Инспектор по кадрам"], size: 3 },
  { key: "it", code: "BN-200", name: "Управление информационных технологий", shortName: "УИТ", parent: "hq", city: "Гомель", description: "Развитие ИТ-инфраструктуры и корпоративных информационных систем", head: "Начальник управления информационных технологий", positions: ["Ведущий инженер-программист", "Системный архитектор"], size: 2 },
  { key: "it_support", code: "BN-210", name: "Служба технической поддержки", shortName: "СТП", parent: "it", city: "Гомель", description: "Обслуживание пользователей, рабочих мест и периферии", head: "Начальник службы технической поддержки", positions: ["Инженер-электроник", "Техник по ремонту ЭВМ"], size: 2 },
  { key: "it_dev", code: "BN-220", name: "Отдел разработки и сопровождения ИС", shortName: "ОРС", parent: "it", city: "Гомель", description: "Разработка и сопровождение корпоративных информационных систем", head: "Начальник отдела", positions: ["Инженер-программист", "Аналитик"], size: 3 },
  { key: "fin", code: "BN-300", name: "Финансово-экономическое управление", shortName: "ФЭУ", parent: "hq", city: "Гомель", description: "Планирование, бюджетирование и экономический анализ", head: "Начальник финансово-экономического управления", positions: ["Экономист", "Ведущий экономист", "Финансист"], size: 3 },
  { key: "acc", code: "BN-310", name: "Главная бухгалтерия", shortName: "ГБ", parent: "hq", city: "Гомель", description: "Бухгалтерский и налоговый учёт", head: "Главный бухгалтер", positions: ["Бухгалтер", "Ведущий бухгалтер"], size: 3 },
  { key: "legal", code: "BN-400", name: "Юридическое управление", shortName: "ЮУ", parent: "hq", city: "Гомель", description: "Правовое сопровождение деятельности объединения", head: "Начальник юридического управления", positions: ["Юрисконсульт", "Ведущий юрисконсульт"], size: 2 },
  { key: "hse", code: "BN-500", name: "Управление охраны труда и промышленной безопасности", shortName: "УОТиПБ", parent: "hq", city: "Гомель", description: "Охрана труда, промышленная и пожарная безопасность", head: "Начальник управления", positions: ["Инженер по охране труда", "Специалист по промышленной безопасности"], size: 2 },
  { key: "ngdu", code: "BN-600", name: "НГДУ «Речицанефть»", shortName: "НГДУ", parent: "hq", city: "Речица", description: "Нефтегазодобывающее управление — добыча нефти и попутного газа на месторождениях Припятского прогиба", head: "Начальник НГДУ «Речицанефть»", positions: ["Инженер-технолог", "Мастер по добыче нефти и газа", "Геолог"], size: 4 },
  { key: "ngdu_cdng", code: "BN-610", name: "Цех добычи нефти и газа № 1", shortName: "ЦДНГ-1", parent: "ngdu", city: "Речица", description: "Эксплуатация фонда добывающих скважин", head: "Начальник цеха", positions: ["Оператор по добыче нефти и газа", "Мастер", "Слесарь-ремонтник"], size: 3 },
  { key: "ubr", code: "BN-700", name: "Управление буровых работ", shortName: "УБР", parent: "hq", city: "Светлогорск", description: "Строительство эксплуатационных и разведочных скважин", head: "Начальник управления буровых работ", positions: ["Буровой мастер", "Инженер по бурению", "Технолог"], size: 3 },
  { key: "bgpz", code: "BN-800", name: "Белорусский газоперерабатывающий завод", shortName: "БГПЗ", parent: "hq", city: "Речица", description: "Переработка попутного нефтяного газа", head: "Директор завода", positions: ["Инженер-технолог", "Оператор технологических установок", "Инженер КИПиА"], size: 3 },
  { key: "nipi", code: "BN-900", name: "Институт «БелНИПИнефть»", shortName: "БелНИПИнефть", parent: "hq", city: "Гомель", description: "Научно-исследовательский и проектный институт", head: "Директор института", positions: ["Научный сотрудник", "Инженер-проектировщик", "Геофизик"], size: 3 },
  { key: "upnp", code: "BN-1000", name: "Светлогорское УПНП и РС", shortName: "УПНПиРС", parent: "hq", city: "Светлогорск", description: "Управление по повышению нефтеотдачи пластов и ремонту скважин", head: "Начальник управления", positions: ["Мастер по капитальному ремонту скважин", "Инженер-технолог"], size: 2 },
  { key: "tamp", code: "BN-1100", name: "Тампонажное управление", shortName: "ТУ", parent: "hq", city: "Речица", description: "Цементирование скважин и тампонажные работы", head: "Начальник тампонажного управления", positions: ["Машинист цементировочного агрегата", "Инженер"], size: 2 },
  { key: "upgr", code: "BN-1200", name: "Управление промыслово-геофизических работ", shortName: "УПГР", parent: "hq", city: "Речица", description: "Геофизические исследования скважин", head: "Начальник управления", positions: ["Геофизик", "Инженер-интерпретатор"], size: 2 },
  { key: "gonp", code: "BN-1300", name: "РУП «Белоруснефть-Гомельоблнефтепродукт»", shortName: "ГОНП", parent: "hq", city: "Гомель", description: "Розничная реализация нефтепродуктов, сеть АЗС Гомельской области", head: "Директор предприятия", positions: ["Оператор АЗС", "Менеджер по продажам", "Инженер"], size: 3 },
];

interface PersonSeed {
  key: string;
  last: string;
  first: string;
  middle: string;
  gender: "male" | "female";
  dept: string;
  position: string;
  isHead?: boolean;
}

// Named personas used by demo accounts.
const PERSONAS: PersonSeed[] = [
  { key: "ceo", last: "Ковалёв", first: "Андрей", middle: "Николаевич", gender: "male", dept: "hq", position: "Генеральный директор", isHead: true },
  { key: "hr_head", last: "Сидоренко", first: "Елена", middle: "Викторовна", gender: "female", dept: "hr", position: "Начальник управления по работе с персоналом", isHead: true },
  { key: "hr_manager", last: "Мельник", first: "Ольга", middle: "Петровна", gender: "female", dept: "hr", position: "Ведущий специалист по кадрам" },
  { key: "it_director", last: "Жуковский", first: "Олег", middle: "Викторович", gender: "male", dept: "it", position: "Начальник управления информационных технологий", isHead: true },
  { key: "admin", last: "Климович", first: "Павел", middle: "Сергеевич", gender: "male", dept: "it", position: "Ведущий системный администратор" },
  { key: "it_head", last: "Новиков", first: "Дмитрий", middle: "Александрович", gender: "male", dept: "it_support", position: "Начальник службы технической поддержки", isHead: true },
  { key: "it_engineer", last: "Лукашевич", first: "Артём", middle: "Игоревич", gender: "male", dept: "it_support", position: "Инженер-электроник 1 категории" },
  { key: "it_engineer2", last: "Савченко", first: "Максим", middle: "Олегович", gender: "male", dept: "it_support", position: "Инженер-электроник 2 категории" },
  { key: "dept_head", last: "Гончаров", first: "Виктор", middle: "Михайлович", gender: "male", dept: "ngdu", position: "Начальник НГДУ «Речицанефть»", isHead: true },
  { key: "employee", last: "Кравченко", first: "Анна", middle: "Сергеевна", gender: "female", dept: "ngdu", position: "Инженер-технолог" },
  { key: "auditor", last: "Демидович", first: "Ирина", middle: "Анатольевна", gender: "female", dept: "fin", position: "Ведущий экономист (внутренний аудит)" },
];

const ROLE_SEEDS: { code: string; name: string; description: string; permissions: string[] }[] = [
  {
    code: "sys_admin",
    name: "Системный администратор",
    description: "Полный доступ к администрированию пользователей, ролей и журналу аудита",
    permissions: ALL_PERMISSIONS.filter((p) => p.startsWith("admin.")),
  },
  {
    code: "employee",
    name: "Сотрудник",
    description: "Базовая роль: заявки в ИТ-поддержку и заявления на отпуск",
    permissions: ["portal.tickets.create", "vacation.access", "vacation.request"],
  },
  {
    code: "hr_head",
    name: "Начальник отдела кадров",
    description: "Полный доступ к приложению «Персонал», просмотр всех заявлений на отпуск",
    permissions: [...ALL_PERMISSIONS.filter((p) => p.startsWith("hr.")), "vacation.view_all", "vacation.audit.view"],
  },
  {
    code: "hr_manager",
    name: "Менеджер по персоналу",
    description: "Приём и ведение сотрудников, документы, оргструктура (просмотр)",
    permissions: [
      "hr.access",
      "hr.employees.view",
      "hr.employees.create",
      "hr.employees.edit",
      "hr.employees.sensitive",
      "hr.documents.manage",
      "hr.departments.view",
    ],
  },
  {
    code: "it_head",
    name: "Начальник ИТ-поддержки",
    description: "Управление заявками, согласование закупок, приёмка работ, учёт оборудования",
    permissions: ALL_PERMISSIONS.filter((p) => p.startsWith("it.")),
  },
  {
    code: "it_engineer",
    name: "Инженер ИТ-поддержки",
    description: "Работа с заявками и запросы на закупку комплектующих",
    permissions: ["it.access", "it.tickets.view", "it.tickets.work", "it.purchases.request", "it.hardware.view"],
  },
  {
    code: "auditor",
    name: "Аудитор",
    description: "Просмотр журналов аудита всех приложений",
    permissions: ["admin.access", "admin.audit.view", "hr.access", "hr.audit.view", "it.access", "it.audit.view", "vacation.audit.view"],
  },
];

const DEMO_USERS: { login: string; password: string; persona: string; roles: string[] }[] = [
  { login: "admin", password: "admin123", persona: "admin", roles: ["sys_admin", "employee"] },
  { login: "hr.head", password: "demo123", persona: "hr_head", roles: ["hr_head", "employee"] },
  { login: "hr.manager", password: "demo123", persona: "hr_manager", roles: ["hr_manager", "employee"] },
  { login: "it.head", password: "demo123", persona: "it_head", roles: ["it_head", "employee"] },
  { login: "it.engineer", password: "demo123", persona: "it_engineer", roles: ["it_engineer", "employee"] },
  { login: "it.engineer2", password: "demo123", persona: "it_engineer2", roles: ["it_engineer", "employee"] },
  { login: "dept.head", password: "demo123", persona: "dept_head", roles: ["employee"] },
  { login: "employee", password: "demo123", persona: "employee", roles: ["employee"] },
  { login: "auditor", password: "demo123", persona: "auditor", roles: ["auditor", "employee"] },
];

function makeAddress(city: string) {
  return {
    region: "Гомельская область",
    city,
    street: pick(STREETS),
    house: String(int(1, 120)),
    apartment: rand() > 0.3 ? String(int(1, 180)) : "",
    postalCode: `${POSTAL[city] ?? "246"}${digits(3)}`,
  };
}

async function buildSeed() {
  const created = iso(daysAgo(400));
  const deptIds = new Map(DEPARTMENTS.map((d) => [d.key, newId()]));
  const employees: Employee[] = [];
  const personaIds = new Map<string, string>();
  const headByDept = new Map<string, string>();
  let personnel = 1000;
  const usedEmails = new Set<string>();

  const addEmployee = (p: Omit<PersonSeed, "key"> & { key?: string }, hireDaysAgo: number) => {
    const dept = DEPARTMENTS.find((d) => d.key === p.dept)!;
    const id = newId();
    let email = `${translit(p.first).charAt(0)}.${translit(p.last)}@belorusneft.by`;
    while (usedEmails.has(email)) email = email.replace("@", `${int(1, 9)}@`);
    usedEmails.add(email);
    const bank = pick(BANKS);
    const birth = daysAgo(int(23, 60) * 365 + int(0, 364));
    const home = makeAddress(dept.city);
    const emp: Employee = {
      id,
      personnelNumber: String(++personnel),
      lastName: p.last,
      firstName: p.first,
      middleName: p.middle,
      birthDate: toISODate(birth),
      gender: p.gender,
      position: p.position,
      departmentId: deptIds.get(p.dept)!,
      hireDate: toISODate(daysAgo(hireDaysAgo)),
      status: hireDaysAgo < 90 ? "probation" : "active",
      email,
      phone: `+375 ${pick(["29", "33", "44", "25"])} ${digits(3)}-${digits(2)}-${digits(2)}`,
      workPhone: `+375 232 ${digits(2)}-${digits(2)}-${digits(2)}`,
      registrationAddress: home,
      residentialAddress: { ...home },
      passport: {
        series: "HB",
        number: digits(7),
        personalNumber: `${digits(7)}${pick(["A", "B", "C", "H", "K"])}${digits(3)}PB${digits(1)}`,
        issuedBy: `${dept.city === "Гомель" ? "Советский" : dept.city === "Речица" ? "Речицкий" : "Светлогорский"} РОВД ${dept.city === "Гомель" ? "г. Гомеля" : "Гомельской обл."}`,
        issuedAt: toISODate(daysAgo(int(1, 9) * 365)),
      },
      bank: { bankName: bank.bankName, bic: bank.bic, iban: `BY${digits(2)}${bank.code}3014${digits(16)}` },
      emergencyContact: {
        name: `${pick(SURNAMES)[p.gender === "male" ? 1 : 0]} ${p.gender === "male" ? pick(FEMALE_FIRST) : pick(MALE_FIRST)}`,
        relation: p.gender === "male" ? "Супруга" : "Супруг",
        phone: `+375 29 ${digits(3)}-${digits(2)}-${digits(2)}`,
      },
      education: pick([
        "Высшее, Гомельский государственный технический университет им. П.О. Сухого",
        "Высшее, Гомельский государственный университет им. Ф. Скорины",
        "Высшее, Белорусский национальный технический университет",
        "Среднее специальное, Речицкий государственный аграрный колледж",
        "Высшее, Белорусский государственный экономический университет",
      ]),
      hrManagerId: null,
      createdAt: created,
      updatedAt: created,
    };
    employees.push(emp);
    if (p.key) personaIds.set(p.key, id);
    if (p.isHead) headByDept.set(p.dept, id);
    return emp;
  };

  for (const p of PERSONAS) addEmployee(p, int(400, 4000));

  const randomPerson = (dept: string, position: string): Omit<PersonSeed, "key"> => {
    const gender = rand() > 0.45 ? "male" : "female";
    const [m, f] = pick(SURNAMES);
    return {
      last: gender === "male" ? m : f,
      first: gender === "male" ? pick(MALE_FIRST) : pick(FEMALE_FIRST),
      middle: gender === "male" ? pick(MALE_MIDDLE) : pick(FEMALE_MIDDLE),
      gender,
      dept,
      position,
    };
  };

  for (const d of DEPARTMENTS) {
    if (!headByDept.has(d.key)) {
      const head = addEmployee({ ...randomPerson(d.key, d.head), isHead: true }, int(800, 6000));
      headByDept.set(d.key, head.id);
    }
    for (let i = 0; i < d.size; i++) {
      // A few recent hires so the HR dashboard has something to show.
      addEmployee(randomPerson(d.key, pick(d.positions)), rand() > 0.85 ? int(5, 60) : int(120, 5000));
    }
  }

  const hrManager = personaIds.get("hr_manager")!;
  const hrHead = personaIds.get("hr_head")!;
  for (const e of employees) {
    if (e.id === hrHead) e.hrManagerId = null;
    else if (e.id === hrManager) e.hrManagerId = hrHead;
    else e.hrManagerId = rand() > 0.3 ? hrManager : hrHead;
  }
  // Demo flow: the regular employee is always managed by hr.manager.
  employees.find((e) => e.id === personaIds.get("employee"))!.hrManagerId = hrManager;
  employees.find((e) => e.id === personaIds.get("dept_head"))!.hrManagerId = hrManager;

  const departments: Department[] = DEPARTMENTS.map((d) => ({
    id: deptIds.get(d.key)!,
    code: d.code,
    name: d.name,
    shortName: d.shortName,
    parentId: d.parent ? deptIds.get(d.parent)! : null,
    headEmployeeId: headByDept.get(d.key)!,
    city: d.city,
    description: d.description,
    createdAt: created,
    updatedAt: created,
  }));

  // Roles & users
  const roles: Role[] = ROLE_SEEDS.map((r) => ({
    id: newId(),
    ...r,
    isSystem: ["sys_admin", "employee"].includes(r.code),
    createdAt: created,
    updatedAt: created,
  }));
  const roleId = (code: string) => roles.find((r) => r.code === code)!.id;
  const users: User[] = DEMO_USERS.map((u) => ({
    id: newId(),
    login: u.login,
    passwordHash: hashPassword(u.password),
    employeeId: personaIds.get(u.persona)!,
    roleIds: u.roles.map(roleId),
    isActive: true,
    lastLoginAt: null,
    createdAt: created,
    updatedAt: created,
  }));
  const userByPersona = (key: string) => users.find((u) => u.employeeId === personaIds.get(key))!;

  // Hardware
  const hardware: Hardware[] = [];
  let inv = 10000;
  const MODELS: Record<HardwareType, [string, string][]> = {
    laptop: [["Lenovo", "ThinkPad T14 Gen 4"], ["HP", "ProBook 450 G10"], ["Dell", "Latitude 5440"]],
    desktop: [["HP", "ProDesk 400 G9"], ["Lenovo", "ThinkCentre M70s"], ["Dell", "OptiPlex 7010"]],
    monitor: [["Dell", "P2422H"], ["Philips", "243V7QDSB"], ["LG", "24MP400"]],
    printer: [["HP", "LaserJet Pro M404dn"], ["Kyocera", "ECOSYS M2540dn"], ["Canon", "i-SENSYS MF445dw"]],
    phone: [["Yealink", "SIP-T31P"], ["Grandstream", "GXP1625"]],
    mobile: [["Samsung", "Galaxy A54"], ["Xiaomi", "Redmi Note 13"]],
    tablet: [["Samsung", "Galaxy Tab Active4 Pro"]],
    peripheral: [["Logitech", "MK270 (клавиатура + мышь)"], ["APC", "Back-UPS 650"]],
    network: [["MikroTik", "hAP ac2"], ["Cisco", "Catalyst 1000-8T"]],
    other: [["Zebra", "TC21 (терминал сбора данных)"]],
  };
  const addHardware = (type: HardwareType, employeeId: string | null, status: Hardware["status"] = employeeId ? "assigned" : "in_stock") => {
    const [manufacturer, model] = pick(MODELS[type]);
    const purchased = daysAgo(int(60, 1500));
    const warranty = new Date(purchased);
    warranty.setFullYear(warranty.getFullYear() + 3);
    const h: Hardware = {
      id: newId(),
      inventoryNumber: `INV-${++inv}`,
      type,
      manufacturer,
      model,
      serialNumber: `${manufacturer.slice(0, 2).toUpperCase()}${digits(8)}`,
      status,
      employeeId,
      assignedAt: employeeId ? iso(daysAgo(int(10, 400))) : null,
      purchaseDate: toISODate(purchased),
      warrantyUntil: toISODate(warranty),
      notes: "",
      createdAt: iso(purchased),
      updatedAt: iso(purchased),
    };
    hardware.push(h);
    return h;
  };
  const officeDepts = new Set(["hq", "hr", "it", "it_support", "it_dev", "fin", "acc", "legal", "hse", "nipi"].map((k) => deptIds.get(k)));
  for (const e of employees) {
    if (rand() > 0.5 || !officeDepts.has(e.departmentId)) addHardware("laptop", e.id);
    else {
      addHardware("desktop", e.id);
      addHardware("monitor", e.id);
    }
    if (rand() > 0.4) addHardware("phone", e.id);
    if (rand() > 0.8) addHardware("mobile", e.id);
  }
  for (const k of ["printer", "printer", "laptop", "laptop", "monitor", "monitor", "peripheral", "network", "tablet", "desktop"] as HardwareType[]) {
    addHardware(k, null);
  }
  const broken = hardware.find((h) => h.type === "printer")!;
  broken.status = "repair";

  // Tickets
  const tickets: Ticket[] = [];
  const comments: TicketComment[] = [];
  const purchases: PurchaseRequest[] = [];
  const engineers = [personaIds.get("it_engineer")!, personaIds.get("it_engineer2")!, personaIds.get("it_head")!];
  const engineerUser = (empId: string) => users.find((u) => u.employeeId === empId);
  const TICKET_TEMPLATES: { title: string; description: string; category: TicketCategory; hw: HardwareType | null }[] = [
    { title: "Ноутбук не включается", description: "После обновления системы ноутбук не загружается, индикатор питания мигает оранжевым.", category: "hardware", hw: "laptop" },
    { title: "Не работает второй монитор", description: "Монитор не определяется системой, пробовал менять кабель — без результата.", category: "hardware", hw: "monitor" },
    { title: "Принтер замял бумагу и выдаёт ошибку", description: "Ошибка 13.B2 на МФУ в кабинете 214, бумага извлечена, ошибка не уходит.", category: "hardware", hw: "printer" },
    { title: "Нет доступа к 1С:Предприятие", description: "При входе в 1С появляется сообщение «Нет прав на вход в базу». Прошу восстановить доступ.", category: "access", hw: null },
    { title: "Медленно работает системный блок", description: "Компьютер долго загружается, программы зависают. Нужна диагностика.", category: "hardware", hw: "desktop" },
    { title: "Не работает IP-телефон", description: "На телефоне нет гудка, на экране «No Service».", category: "network", hw: "phone" },
    { title: "Установить AutoCAD 2025", description: "Для работы с проектной документацией требуется установка AutoCAD.", category: "software", hw: "laptop" },
    { title: "Не подключается VPN", description: "При работе на месторождении не устанавливается VPN-соединение с корпоративной сетью.", category: "network", hw: "laptop" },
    { title: "Сброс пароля к почте", description: "Забыл пароль от корпоративной почты, требуется сброс.", category: "access", hw: null },
    { title: "Треснул экран смартфона", description: "Служебный смартфон упал, экран треснул, сенсор работает частично.", category: "hardware", hw: "mobile" },
    { title: "Нужна замена клавиатуры", description: "Залипают клавиши, часть клавиш не работает.", category: "hardware", hw: "laptop" },
    { title: "Ошибка при печати из СЭД", description: "Документы из системы электронного документооборота печатаются пустыми листами.", category: "software", hw: null },
  ];
  const statusPlan: TicketStatus[] = [
    "new", "new", "new", "new", "in_progress", "in_progress", "in_progress", "in_progress", "waiting_purchase", "waiting_purchase",
    "resolved", "resolved", "resolved", "closed", "closed", "closed", "closed", "closed", "closed", "cancelled", "new", "in_progress",
  ];
  const priorities: TicketPriority[] = ["low", "medium", "medium", "medium", "high", "high", "critical"];
  const requesterPool = employees.filter((e) => !engineers.includes(e.id));
  const employeePersona = personaIds.get("employee")!;
  statusPlan.forEach((status, i) => {
    const tpl = TICKET_TEMPLATES[i % TICKET_TEMPLATES.length];
    let requester = i < 3 ? employees.find((e) => e.id === employeePersona)! : pick(requesterPool);
    let hw = tpl.hw ? hardware.find((h) => h.employeeId === requester.id && h.type === tpl.hw) : undefined;
    if (tpl.hw && !hw) {
      const owner = hardware.find((h) => h.type === tpl.hw && h.employeeId && !engineers.includes(h.employeeId));
      if (owner) {
        requester = employees.find((e) => e.id === owner.employeeId)!;
        hw = owner;
      }
    }
    const createdAt = daysAgo(int(0, 28), int(8, 17));
    const assignee = status === "new" ? null : pick(engineers);
    const createdBy = users.find((u) => u.employeeId === requester.id) ?? userByPersona("admin");
    const t: Ticket = {
      id: newId(),
      number: i + 1,
      title: tpl.title,
      description: tpl.description,
      category: tpl.category,
      priority: pick(priorities),
      status,
      requesterEmployeeId: requester.id,
      createdByUserId: createdBy.id,
      departmentId: requester.departmentId,
      hardwareId: hw?.id ?? null,
      assigneeEmployeeId: assignee,
      resolution: ["resolved", "closed"].includes(status) ? "Проведена диагностика, неисправность устранена. Работоспособность проверена совместно с пользователем." : "",
      resolvedAt: ["resolved", "closed"].includes(status) ? iso(new Date(createdAt.getTime() + 86_400_000)) : null,
      closedAt: status === "closed" ? iso(new Date(createdAt.getTime() + 2 * 86_400_000)) : null,
      verifiedByUserId: status === "closed" ? userByPersona("it_head").id : null,
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
    };
    tickets.push(t);
    comments.push({ id: newId(), ticketId: t.id, userId: createdBy.id, text: "Заявка создана", kind: "system", createdAt: t.createdAt });
    if (assignee) {
      const eu = engineerUser(assignee);
      comments.push({
        id: newId(),
        ticketId: t.id,
        userId: eu?.id ?? createdBy.id,
        text: "Добрый день! Заявку взял в работу, свяжусь с вами в ближайшее время.",
        kind: "comment",
        createdAt: iso(new Date(createdAt.getTime() + 3_600_000)),
      });
    }
    if (status === "waiting_purchase" || (status === "closed" && i % 3 === 0)) {
      const eu = engineerUser(assignee!) ?? userByPersona("it_engineer");
      purchases.push({
        id: newId(),
        number: purchases.length + 1,
        ticketId: t.id,
        requestedByUserId: eu.id,
        items:
          tpl.hw === "laptop"
            ? [{ name: "Аккумуляторная батарея для ноутбука", quantity: 1, unitPrice: 189.5 }]
            : tpl.hw === "printer"
              ? [{ name: "Ролик захвата бумаги", quantity: 2, unitPrice: 34.9 }, { name: "Картридж CF259X", quantity: 1, unitPrice: 245 }]
              : [{ name: "Блок питания 500W", quantity: 1, unitPrice: 129 }, { name: "SSD 512 ГБ", quantity: 1, unitPrice: 155 }],
        justification: "Для восстановления работоспособности оборудования требуется замена неисправных комплектующих.",
        status: status === "closed" ? "delivered" : "in_progress",
        decidedByUserId: status === "closed" ? userByPersona("it_head").id : null,
        decidedAt: status === "closed" ? iso(new Date(createdAt.getTime() + 86_400_000)) : null,
        decisionComment: status === "closed" ? "Согласовано" : "",
        createdAt: iso(new Date(createdAt.getTime() + 7_200_000)),
        updatedAt: iso(new Date(createdAt.getTime() + 7_200_000)),
      });
    }
  });

  // Leave requests
  const leaves: LeaveRequest[] = [];
  const step = (approver: string | null, status: ApprovalStep["status"], at?: Date): ApprovalStep => ({
    approverEmployeeId: approver,
    status: approver ? status : "skipped",
    decidedAt: approver && status !== "pending" ? iso(at ?? NOW) : null,
    comment: "",
  });
  const addLeave = (empId: string, type: LeaveType, start: number, len: number, status: LeaveRequest["status"], headStatus: ApprovalStep["status"], hrStatus: ApprovalStep["status"]) => {
    const emp = employees.find((e) => e.id === empId)!;
    const head = resolveHeadApprover(emp, departments);
    const createdAt = daysAgo(Math.max(1, -start + int(5, 20)));
    const user = users.find((u) => u.employeeId === empId) ?? userByPersona("hr_manager");
    leaves.push({
      id: newId(),
      number: leaves.length + 1,
      employeeId: empId,
      type,
      startDate: dateOffset(start),
      endDate: dateOffset(start + len - 1),
      days: len,
      reason: type === "sick" ? "Листок нетрудоспособности" : type === "unpaid" ? "Семейные обстоятельства" : "",
      status,
      headApproval: step(head, headStatus, createdAt),
      hrApproval: step(emp.hrManagerId, hrStatus, createdAt),
      createdByUserId: user.id,
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
    });
  };
  addLeave(personaIds.get("employee")!, "annual", -120, 14, "approved", "approved", "approved");
  addLeave(personaIds.get("employee")!, "annual", 21, 7, "pending", "pending", "pending");
  addLeave(personaIds.get("employee")!, "sick", -40, 5, "approved", "approved", "approved");
  addLeave(personaIds.get("it_engineer")!, "annual", 10, 10, "pending", "approved", "pending");
  addLeave(personaIds.get("it_engineer2")!, "annual", -3, 12, "approved", "approved", "approved");
  addLeave(personaIds.get("hr_manager")!, "annual", 45, 14, "pending", "pending", "pending");
  addLeave(personaIds.get("dept_head")!, "annual", -200, 21, "approved", "approved", "approved");
  const ngduStaff = employees.filter((e) => e.departmentId === deptIds.get("ngdu") && e.id !== personaIds.get("dept_head") && e.id !== employeePersona);
  ngduStaff.forEach((e, i) => addLeave(e.id, i % 2 ? "unpaid" : "annual", 5 + i * 9, 3 + i * 2, "pending", "pending", i % 2 ? "approved" : "pending"));
  employees
    .filter((e) => !ngduStaff.includes(e) && !Object.values(Object.fromEntries(personaIds)).includes(e.id))
    .slice(0, 12)
    .forEach((e, i) => {
      const status = i % 4 === 3 ? "rejected" : "approved";
      addLeave(e.id, i % 5 === 0 ? "sick" : "annual", int(-60, 40), int(3, 14), status, "approved", status === "rejected" ? "rejected" : "approved");
    });

  const auditLogs: AuditLog[] = (["admin", "hr", "it", "vacation"] as const).map((app) => ({
    id: newId(),
    app,
    action: "system.seed",
    entityType: "system",
    entityId: "seed",
    userId: null,
    summary: "Первичное наполнение данными",
    changes: null,
    createdAt: iso(daysAgo(30)),
  }));

  return {
    departments,
    employees,
    roles,
    users,
    hardware,
    tickets,
    ticket_comments: comments,
    purchase_requests: purchases,
    leave_requests: leaves,
    audit_logs: auditLogs,
  };
}

async function seed() {
  const existing = await pool.query("SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM employees) AS has_data");
  if (existing.rows[0].has_data) {
    console.log("Database already contains portal data, seed skipped.");
    return;
  }
  const data = await buildSeed();
  await transaction(async (client) => {
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    // Insertion order follows foreign keys; the departments <-> employees cycle is resolved by deferral.
    for (const [name, rows] of Object.entries(data) as [TableName, Tables[TableName][]][]) {
      for (const row of rows) await insert(name, row, client);
      console.log(`Seeded ${name}: ${rows.length}`);
    }
  });
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
