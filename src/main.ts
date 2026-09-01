import "./styles.css";
import { startApplication } from "./application";
import { installMockDatabase } from "./mock/database";
import { startSchedule } from "./schedule";

if (import.meta.env.DEV) {
  installMockDatabase();
}

void Promise.all([startApplication(), startSchedule()]);
