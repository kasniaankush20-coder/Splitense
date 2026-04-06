function generateId(prefix = "item") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function getDateOnly(value = new Date()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + distance);
  return getDateOnly(date);
}

function endOfWeek(dateString) {
  const start = new Date(`${startOfWeek(dateString)}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return getDateOnly(start);
}

function startOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}

function endOfMonth(dateString) {
  const date = new Date(`${startOfMonth(dateString)}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return getDateOnly(date);
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function groupTotalsByCategory(items) {
  return items.reduce((accumulator, item) => {
    const category = item.category || "Other";
    accumulator[category] = (accumulator[category] || 0) + Number(item.amount || 0);
    return accumulator;
  }, {});
}

function isDateInRange(date, start, end) {
  return date >= start && date <= end;
}

module.exports = {
  endOfMonth,
  endOfWeek,
  generateId,
  getDateOnly,
  groupTotalsByCategory,
  isDateInRange,
  startOfMonth,
  startOfWeek,
  sumAmounts,
};
