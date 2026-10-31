import type { AppCode } from "./enums.js";

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  app: AppCode | "portal";
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    app: "portal",
    label: "Портал",
    permissions: [
      { key: "portal.tickets.create", label: "Создание заявок в ИТ", description: "Создавать обращения в ИТ-поддержку с главной страницы" },
    ],
  },
  {
    app: "admin",
    label: "Администрирование",
    permissions: [
      { key: "admin.access", label: "Доступ к приложению", description: "Вход в приложение «Администрирование»" },
      { key: "admin.users.view", label: "Просмотр пользователей", description: "Просмотр списка учётных записей" },
      { key: "admin.users.manage", label: "Управление пользователями", description: "Создание, блокировка, сброс пароля, назначение ролей" },
      { key: "admin.roles.view", label: "Просмотр ролей", description: "Просмотр ролей и матрицы прав" },
      { key: "admin.roles.manage", label: "Управление ролями", description: "Создание и изменение ролей и их прав" },
      { key: "admin.audit.view", label: "Журнал аудита (все приложения)", description: "Просмотр журнала действий по всем приложениям" },
    ],
  },
  {
    app: "hr",
    label: "Персонал",
    permissions: [
      { key: "hr.access", label: "Доступ к приложению", description: "Вход в приложение «Персонал»" },
      { key: "hr.employees.view", label: "Просмотр сотрудников", description: "Просмотр карточек сотрудников" },
      { key: "hr.employees.create", label: "Приём сотрудников", description: "Регистрация новых сотрудников" },
      { key: "hr.employees.edit", label: "Редактирование сотрудников", description: "Изменение карточек сотрудников" },
      { key: "hr.employees.sensitive", label: "Персональные данные", description: "Просмотр паспортных и банковских данных" },
      { key: "hr.documents.manage", label: "Управление документами", description: "Загрузка и удаление документов сотрудников" },
      { key: "hr.departments.view", label: "Просмотр оргструктуры", description: "Просмотр подразделений" },
      { key: "hr.departments.manage", label: "Управление оргструктурой", description: "Создание и изменение подразделений" },
      { key: "hr.audit.view", label: "Журнал аудита", description: "Просмотр журнала действий приложения" },
    ],
  },
  {
    app: "it",
    label: "ИТ-поддержка",
    permissions: [
      { key: "it.access", label: "Доступ к приложению", description: "Вход в приложение «ИТ-поддержка»" },
      { key: "it.tickets.view", label: "Просмотр всех заявок", description: "Доступ к доске и списку заявок" },
      { key: "it.tickets.work", label: "Работа с заявками", description: "Взятие заявок в работу, комментарии, решение" },
      { key: "it.tickets.assign", label: "Назначение исполнителей", description: "Назначение инженеров на любые заявки" },
      { key: "it.tickets.verify", label: "Проверка выполнения", description: "Приёмка решённых заявок и возврат на доработку" },
      { key: "it.purchases.request", label: "Запрос закупок", description: "Создание запросов на закупку комплектующих" },
      { key: "it.purchases.approve", label: "Согласование закупок", description: "Одобрение и отклонение закупок" },
      { key: "it.hardware.view", label: "Просмотр оборудования", description: "Реестр оборудования" },
      { key: "it.hardware.manage", label: "Управление оборудованием", description: "Добавление, выдача и изъятие оборудования" },
      { key: "it.audit.view", label: "Журнал аудита", description: "Просмотр журнала действий приложения" },
    ],
  },
  {
    app: "vacation",
    label: "Отпуска",
    permissions: [
      { key: "vacation.access", label: "Доступ к приложению", description: "Вход в приложение «Отпуска»" },
      { key: "vacation.request", label: "Подача заявлений", description: "Подача заявлений на отпуск и больничный" },
      { key: "vacation.view_all", label: "Просмотр всех заявлений", description: "Просмотр заявлений всех сотрудников" },
      { key: "vacation.audit.view", label: "Журнал аудита", description: "Просмотр журнала действий приложения" },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export function permissionLabel(key: string): string {
  for (const g of PERMISSION_GROUPS) {
    const p = g.permissions.find((x) => x.key === key);
    if (p) return p.label;
  }
  return key;
}

export function hasPermission(permissions: Iterable<string>, key: string): boolean {
  for (const p of permissions) if (p === key) return true;
  return false;
}
