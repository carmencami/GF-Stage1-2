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
  await notion.pages.update({
    page_id: id,
    properties: { "Last Contact": { date: { start: today } } },
  });
}

async function updateTags(id, newTag, isTest) {
  if (isTest) return console.log("📝 [TEST] updateTags:", id, newTag);
  const page = await notion.pages.retrieve({ page_id: id });
  const tags = page.properties["GF Follow up"].multi_select.map((t) => t.name);
  if (!tags.includes(newTag)) {
    tags.push(newTag);
    await notion.pages.update({
      page_id: id,
      properties: {
        "GF Follow up": { multi_select: tags.map((n) => ({ name: n })) },
      },
    });
  }
}

async function updatePlacementStatus(id, isTest) {
  if (isTest)
    return console.log("📝 [TEST] updatePlacementStatus → Missing:", id);
  await notion.pages.update({
    page_id: id,
    properties: { "Placement status": { select: { name: "Missing" } } },
  });
}

// Función para extraer datos de Notion (copiada de zappier.js)
function extractNotionDataValue(data, label) {
  let field = data.properties[label];
  if (!field) return undefined;
  const fieldType = field.type;
  field = field[fieldType];
  switch (fieldType) {
    case "title":
    case "rich_text":
      return field[0]?.plain_text.trim();
    case "phone_number":
    case "email":
      return field?.trim();
    case "date":
      return field?.start?.trim();
    case "multi_select":
      return field?.map((item) => item.name.trim()) ?? [];
    case "status":
    case "select":
      return field?.name?.trim();
    case "formula":
      return field?.string?.trim() || field?.number;
    case "rollup":
      // Soporte para rollup de tipo date (y otros posibles tipos)
      if (field?.type === "date" && field.date?.start) {
        return field.date.start.trim();
      }
      // Otros posibles tipos de rollup pueden agregarse aquí
      return undefined;
    default:
      return undefined;
  }
}

// Consulta única a Notion (adaptada para usar extractNotionDataValue)
async function fetchStudents() {
  const pages = [];
  let cursor = undefined;

  do {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: {
        and: [
          { property: "Placement status", status: { equals: "To be placed" } },
          { property: "Educational Status", select: { equals: "Graduated" } },
        ],
      },
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages.map((st) => {
    const stage = extractNotionDataValue(st, "GeekFORCE Stage");
    const days = Number(
      extractNotionDataValue(st, `Days in Stage ${stage?.split(" ")[1]}`)
    );
    return {
      id: st.id,
      name: extractNotionDataValue(st, "Student"),
      slackId: extractNotionDataValue(st, "Slack ID"),
      coach: st.properties["GeekFORCE Coach"]?.select?.name,
      stage,
      days,
      lastContact: extractNotionDataValue(st, "Last Contact"),
      cohortEnd: extractNotionDataValue(st, "Cohort end date"),
      tags: extractNotionDataValue(st, "GF Follow up") || [],
    };
  });
}

// Clasificación y mensajes
function classifyAndBuildMessages(students) {
  const now = new Date();
  const flows = [];

  students.forEach((st) => {
    const days = st.days;
    const cohortEnd = st.cohortEnd ? new Date(st.cohortEnd) : null;
    const lastContact = st.lastContact ? new Date(st.lastContact) : null;
    const daysSinceLastContact = lastContact
      ? (now - lastContact) / (1000 * 60 * 60 * 24)
      : Infinity;
    const monthsToCohortEnd = cohortEnd
      ? (cohortEnd - now) / (1000 * 60 * 60 * 24 * 30)
      : Infinity;

    const isStage1 = st.stage === "Stage 1";
    const isStage2 = st.stage === "Stage 2";
    const hasMsg1Tag =
      st.tags.includes("ST1 - Message 1") ||
      st.tags.includes("ST2 - Message 1");
    const hasMsg2Tag =
      st.tags.includes("ST1 - Msg 2") || st.tags.includes("ST2 - Msg 2");


    // Stage 1 - Seguimiento
    if (isStage1 && days >= 15 && days < 30 && !hasMsg1Tag) {
      flows.push({
        student: st,
        flow: "S1-Seguimiento",
        tag: "ST1 - Message 1",
        msgType: 1,
      });
      console.log(`→ Flujo: Stage 1 - Seguimiento`);
    }
    // Stage 2 - Seguimiento
    else if (isStage2 && days >= 15 && days < 30 && !hasMsg1Tag) {
      flows.push({
        student: st,
        flow: "S2-Seguimiento",
        tag: "ST2 - Message 1",
        msgType: 1,
      });
      console.log(`→ Flujo: Stage 2 - Seguimiento`);
    }
    // Stage 1 - Estancado
    else if (
      isStage1 &&
      days >= 30 &&
      days <= 45 &&
      monthsToCohortEnd > 2 &&
      daysSinceLastContact > 30 &&
      !st.tags.includes("ST1 - Msg 2")
    ) {
      flows.push({
        student: st,
        flow: "S1-Estancado",
        tag: "ST1 - Msg 2",
        msgType: 2,
      });
      console.log(`→ Flujo: Stage 1 - Estancado`);
    }
    // Stage 2 - Estancado
    else if (
      isStage2 &&
      days >= 45 &&
      days <= 60 &&
      monthsToCohortEnd > 2 &&
      daysSinceLastContact > 30 &&
      !st.tags.includes("ST2 - Msg 2")
    ) {
      flows.push({
        student: st,
        flow: "S2-Estancado",
        tag: "ST2 - Msg 2",
        msgType: 2,
      });
      console.log(`→ Flujo: Stage 2 - Estancado`);
    }
    // Stage 1 - Cambio de estado
    else if (isStage1 && days > 45 && hasMsg1Tag && daysSinceLastContact > 30) {
      flows.push({ student: st, flow: "S1-CambioEstado" });
      console.log(`→ Flujo: Stage 1 - Cambio de estado`);
    }
    // Stage 2 - Cambio de estado
    else if (isStage2 && days > 60 && hasMsg1Tag && daysSinceLastContact > 30) {
      flows.push({ student: st, flow: "S2-CambioEstado" });
      console.log(`→ Flujo: Stage 2 - Cambio de estado`);
    }
  });

  return flows;
}

// Generador de mensajes
const calendly = {
  "Yoaní Palmás": "https://calendly.com/yoanipalmas/30min",
  "Melissa Zwanck": "https://calendly.com/melissazwanck/mentoring",
  "Cristina Crespo": "https://calendly.com/ccrespo-4geeksacademy/30min",
};
const guiaGF =
  "https://www.notion.so/4geeksacademy/GeekFORCE-Student-Page-260b99bb21ab4555a46740473fe416e0";

function buildPayload(flows) {
  return flows
    .map(({ student, flow, msgType, tag }) => {
      const { slackId, name, coach, id } = student;
      const tstamp = new Date().toISOString();
      let msg = "";
      let tagToAdd = tag || null;
      const calendlyLink =
        calendly[coach] || "https://calendly.com/4geeksacademy";

      if (flow === "S1-Seguimiento") {
        msg = `Hola <@${slackId}>, ¿cómo estás? Te escribo porque he notado que llevas varias semanas en la etapa 1 del proceso de Career Support.\n\n¿Tienes listos tu CV, LinkedIn y GitHub para seguir avanzando? Si es así, envíame tus perfiles por aquí para echarles un vistazo.\n\nTienes que comenzar la etapa 2 (preparación para entrevistas) lo antes posible. Agenda la sesión (<${calendlyLink}|Calendly>) y prepárate con estos materiales (<${guiaGF}|Guía GeekFORCE Student Page>).\n\nSi tienes algún bloqueo que te impida avanzar, cuéntame y te ayudo a resolverlo :)\n\nEspero tu respuesta para saber en qué punto te encuentras.`;
      } else if (flow === "S2-Seguimiento") {
        msg = `Hola <@${slackId}>, ¿cómo estás? Te escribo porque he notado que llevas varias semanas en la etapa 2 del proceso de Career Support.\n\n¿Hay algo que te impida seguir avanzando? Si tienes algún bloqueo, cuéntame para poder ayudarte.\n\nTienes que completar la preparación para entrevistas lo antes posible para pasar a la etapa 3 (guía y acompañamiento durante la búsqueda de trabajo).\n\nEspero tu respuesta para saber en qué punto te encuentras :)`;
      } else if (flow === "S1-Estancado" || flow === "S2-Estancado") {
        msg = `Hola <@${slackId}>, hace mucho que no avanzas en el proceso de Career Support 😔\n\n¿Te interesa continuar con las siguientes etapas?`;
      } else {
        msg = null; // Para los flujos de cambio de estado no se envía mensaje
      }

      if (!msg) {
        // Para los flujos sin mensaje, podríamos querer mantener el objeto para
        // las acciones de Notion, pero sin enviarlo al webhook.
        // O podemos filtrarlo antes. Por ahora, devolvemos null para filtrar.
        return { studentId: id, slackId, coach, flow, message: null, tagToAdd };
      }

      return {
        // Formato para el webhook
        message: msg,
        slackId,
        coachIdentifier: coach,
        timestamp: tstamp,
        // Datos adicionales para las acciones de Notion
        _studentId: id,
        _flow: flow,
        _tagToAdd: tagToAdd,
      };
    })
    .filter((item) => item.message); // Nos aseguramos de no incluir los que no tienen mensaje
}

// Función principal
async function main(isTest = false) {
  const students = await fetchStudents();
  const flows = classifyAndBuildMessages(students);
  const payload = buildPayload(flows);

  if (isTest) {
    console.log("\n📤 Mensajes que se enviarían:");
    payload.forEach((item, idx) => {
      if (item.message) {
        console.log(
          `\nMensaje #${idx + 1} para ${item.coachIdentifier}:\n${item.message}`
        );
      } else {
        console.log(`\nCambio de estado para estudiante: ${item._studentId}`);
      }
    });
  } else {
    await axios.post(webhookUrl, payload);
    await wait(5000);
  }

  for (const item of payload) {
    // Necesitamos recuperar los datos que no se envían al webhook.
    // Una opción es buscarlos en los flows originales por slackId, asumiendo que es único por ejecución.
    const originalData = flows.find((f) => f.student.slackId === item.slackId);
    if (!originalData) continue;

    const { student, flow, tag } = originalData;
    if (flow.endsWith("CambioEstado"))
      await updatePlacementStatus(student.id, isTest);
    else {
      await updateLastContact(student.id, isTest);
      if (tag) await updateTags(student.id, tag, isTest);
    }
  }
}

// Ejecución (usa isTest=true para pruebas)
main(false).catch(console.error);
