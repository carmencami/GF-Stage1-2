require("dotenv").config();
const axios = require("axios");
const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;
const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Funciones auxiliares para Notion
async function updateLastContact(id, isTest) {
  if (isTest) return console.log("📝 [TEST] updateLastContact:", id);
  const today = new Date().toISOString().split("T")[0];
  await notion.pages.update({ page_id: id, properties: { "Last Contact": { date: { start: today } } } });
}

async function updateTags(id, newTag, isTest) {
  if (isTest) return console.log("📝 [TEST] updateTags:", id, newTag);
  const page = await notion.pages.retrieve({ page_id: id });
  const tags = page.properties["GF Follow up"].multi_select.map(t => t.name);
  if (!tags.includes(newTag)) {
    tags.push(newTag);
    await notion.pages.update({
      page_id: id,
      properties: { "GF Follow up": { multi_select: tags.map(n => ({ name: n })) } }
    });
  }
}

async function updatePlacementStatus(id, isTest) {
  if (isTest) return console.log("📝 [TEST] updatePlacementStatus → Missing:", id);
  await notion.pages.update({
    page_id: id,
    properties: { "Placement status": { select: { name: "Missing" } } }
  });
}

// Extractor genérico
function extractVal(page, label) {
  const prop = page.properties[label];
  if (!prop) return;
  const t = prop.type;
  const v = prop[t];
  if (["title", "rich_text"].includes(t)) return v[0]?.plain_text;
  if (["number", "formula"].includes(t)) return prop[type] === "formula" ? prop.formula.number : prop[t];
  if (["select", "status"]) return v.name;
  if (t === "multi_select") return v.map(i => i.name);
  if (t === "date") return v.start;
}

// Consulta única a Notion
async function fetchStudents() {
  const pages = [];
  let cursor = undefined;

  do {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: {
        and: [
          { property: "Placement status", select: { equals: "To be placed" } },
          { property: "Educational Status", select: { equals: "Graduated" } },
        ]
      }
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages.map(st => ({
    id: st.id,
    slackId: extractVal(st, "Slack ID"),
    coach: extractVal(st, "GeekFORCE Coach"),
    stage: extractVal(st, "GeekFORCE Stage"),
    days: Number(extractVal(st, `Days in Stage ${extractVal(st, "GeekFORCE Stage").split(" ")[1]}`)),
    lastContact: extractVal(st, "Last Contact"),
    cohortEnd: extractVal(st, "Cohort end date"),
    tags: extractVal(st, "GF Follow up") || []
  }));
}

// Clasificación y mensajes
function classifyAndBuildMessages(students) {
  const now = Date.now();
  const flows = [];

  students.forEach(st => {
    const days = st.days;
    const monthsSinceLast = st.lastContact ? (now - new Date(st.lastContact)) / (1000 * 60 * 60 * 24 * 30) : Infinity;

    const isStage1 = st.stage === "Stage 1";
    const isStage2 = st.stage === "Stage 2";

    // Flow 1: Stage1 seguimiento
    if (isStage1 && days >= 15 && days < 30 && days < 45 && !st.tags.includes("ST1 - Message 1")) {
      flows.push({ student: st, flow: "S1-S1", tag: "ST1 - Message 1", msgType: 1 });
    }
    // Flow 2: Stage2 seguimiento
    else if (isStage2 && days >= 15 && days < 30 && !st.tags.includes("ST2 - Message 1")) {
      flows.push({ student: st, flow: "S2-S1", tag: "ST2 - Message 1", msgType: 1 });
    }
    // Flow 3: Stage1 estancado
    else if (isStage1 && days >= 30 && new Date(st.cohortEnd) < new Date(Date.now() + 2 * 30 * 24 * 3600 * 1000) && monthsSinceLast > 1 && !st.tags.includes("ST1 - Msg 2")) {
      flows.push({ student: st, flow: "S1-S2", tag: "ST1 - Msg 2", msgType: 2 });
    }
    // Flow 4: Stage2 estancado
    else if (isStage2 && days >= 45 && new Date(st.cohortEnd) < new Date(Date.now() + 2 * 30 * 24 * 3600 * 1000) && monthsSinceLast > 1 && !st.tags.includes("ST2 - Msg 2")) {
      flows.push({ student: st, flow: "S2-S2", tag: "ST2 - Msg 2", msgType: 2 });
    }
    // Flow 5: Stage1 cambio estado
    else if (isStage1 && days >= 30 && st.tags.includes("ST1 - Message 1") && monthsSinceLast > 1) {
      flows.push({ student: st, flow: "S1-Missing" });
    }
    // Flow 6: Stage2 cambio estado
    else if (isStage2 && days >= 45 && st.tags.includes("ST2 - Message 1") && monthsSinceLast > 1) {
      flows.push({ student: st, flow: "S2-Missing" });
    }
  });

  return flows;
}

// Generador de mensajes
const calendly = {
  "Yoaní Palmás": "...",
  "Melissa Zwanck": "...",
  "Cristina Crespo": "..."
};

function buildPayload(flows) {
  return flows.map(({ student, flow, msgType }) => {
    const { slackId, name, coach, id } = student;
    const tstamp = new Date().toISOString();
    let msg = "", tagToAdd = null;

    if (flow.endsWith("-Missing")) {
      msg = null;
    } else if (msgType === 1) {
      const link = calendly[coach];
      msg = `<@${slackId}>\nH ola ${name}, ... [Msg 1 contenido]`;
    } else {
      msg = `<@${slackId}>\nHola ${name}, ... [Msg 2 contenido]`;
    }

    if (flow.startsWith("S1-")) tagToAdd = flow.includes("Message 1") ? "ST1 - Message 1" : "ST1 - Msg 2";
    if (flow.startsWith("S2-")) tagToAdd = flow.includes("Message 1") ? "ST2 - Message 1" : "ST2 - Msg 2";

    return { studentId: id, slackId, coach, flow, message: msg, tagToAdd };
  });
}

// Función principal
async function main(isTest = false) {
  const students = await fetchStudents();
  const flows = classifyAndBuildMessages(students);
  const payload = buildPayload(flows);

  if (isTest) console.log("📤 Payload:", payload);
  else {
    await axios.post(webhookUrl, payload);
    await wait(5000);
  }

  for (const item of payload) {
    const { studentId, flow, tagToAdd } = item;
    if (flow.endsWith("-Missing")) await updatePlacementStatus(studentId, isTest);
    else {
      await updateLastContact(studentId, isTest);
      await updateTags(studentId, tagToAdd, isTest);
    }
  }
}

// Ejecución (usa isTest=false en producción)
main(true).catch(console.error);
