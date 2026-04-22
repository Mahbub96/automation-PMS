const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const { APP_TIMEZONE, CUTOFF_HOUR, CUTOFF_MINUTE } = require("./constants");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

function nowDhaka() {
  return dayjs().tz(APP_TIMEZONE);
}

function dateKeyDhaka(input) {
  return (input ? dayjs(input) : nowDhaka()).tz(APP_TIMEZONE).format("YYYY-MM-DD");
}

function cutoffTimeDhaka(dateKey) {
  return dayjs.tz(
    `${dateKey} ${String(CUTOFF_HOUR).padStart(2, "0")}:${String(CUTOFF_MINUTE).padStart(2, "0")}:00`,
    "YYYY-MM-DD HH:mm:ss",
    APP_TIMEZONE
  );
}

module.exports = { dayjs, nowDhaka, dateKeyDhaka, cutoffTimeDhaka };
