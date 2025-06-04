require("dotenv").config();
const axios = require("axios");
const { Client } = require("@notionhq/client");

const token = process.env.NOTION_TOKEN;
const notion_version = process.env.NOTION_VERSION || "2022-06-28";
const database_id = process.env.NOTION_DATABASE_ID;

// Inicializar cliente de Notion
const notion = new Client({
  auth: token,
});

// Función para esperar
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Función para actualizar último contacto
async function updateStudentLastContact(studentNotionId, isTest = false) {
  if (isTest) {
    console.log(
      `\n📝 MODO TEST - Simulando actualización de último contacto para estudiante ${studentNotionId}`
    );
    return true;
  }

  try {
    const today = new Date().toISOString().split("T")[0];

    await notion.pages.update({
      page_id: studentNotionId,
      properties: {
        "Last Contact": {
          date: {
            start: today,
          },
        },
      },
    });
    console.log(
      `✅ Actualizada fecha de último contacto para estudiante ${studentNotionId}`
    );
    return true;
  } catch (error) {
    console.error(
      `❌ Error al actualizar último contacto para estudiante ${studentNotionId}:`,
      error.message
    );
    throw error;
  }
}

// Función para actualizar etiquetas del estudiante
async function updateStudentTags(studentNotionId, newTag, isTest = false) {
  if (isTest) {
    console.log(
      `\n📝 MODO TEST - Simulando actualización de etiquetas para estudiante ${studentNotionId}`
    );
    console.log(`Nueva etiqueta a agregar: ${newTag}`);
    return true;
  }

  try {
    // Primero obtenemos las etiquetas actuales
    const page = await notion.pages.retrieve({ page_id: studentNotionId });
    const currentTags = page.properties["GF Follow up"]?.multi_select || [];

    // Verificamos si la etiqueta ya existe
    if (currentTags.some((tag) => tag.name === newTag)) {
      console.log(
        `ℹ️ El estudiante ${studentNotionId} ya tiene la etiqueta ${newTag}`
      );
      return true;
    }

    // Agregamos la nueva etiqueta
    await notion.pages.update({
      page_id: studentNotionId,
      properties: {
        "GF Follow up": {
          multi_select: [...currentTags, { name: newTag }],
        },
      },
    });
    console.log(
      `✅ Etiqueta ${newTag} agregada al estudiante ${studentNotionId}`
    );
    return true;
  } catch (error) {
    console.error(
      `❌ Error al actualizar etiquetas para estudiante ${studentNotionId}:`,
      error.message
    );
    throw error;
  }
}

// Función para enviar mensajes a Zapier
async function sendToZapierWebhook(messages, isTest = false) {
  if (isTest) {
    console.log("\n📤 MODO TEST - SIMULACIÓN DE ENVÍO A ZAPIER");
    console.log("\n📝 CONTENIDO DE LOS MENSAJES:");
    messages.forEach((msg, index) => {
      console.log(`\nMensaje #${index + 1}:`);
      console.log("Coach:", msg.coachIdentifier);
      console.log("Slack ID:", msg.slackId);
    });
    console.log("✅ Simulación completada");
    return true;
  }

  try {
    console.log(":bandeja_de_salida: Enviando mensajes a Zapier...");
    const response = await axios.post(process.env.ZAPIER_WEBHOOK_URL, messages);
    // Verificar la respuesta del webhook
    if (response.status === 200) {
      console.log(
        ":marca_de_verificación_blanca: Respuesta del webhook recibida:",
        response.data
      );
      // Esperar 5 segundos para dar tiempo a que Zapier procese los mensajes
      console.log(
        ":reloj_de_arena_en_marcha: Esperando 5 segundos para asegurar el procesamiento..."
      );
      await wait(5000);
      return true;
    } else {
      console.error(":x: Respuesta inesperada del webhook:", response.status);
      return false;
    }
  } catch (error) {
    console.error(":x: Error al enviar mensajes a Zapier:", error.message);
    if (error.response) {
      console.error("Detalles de la respuesta:", error.response.data);
    }
    return false;
  }
}

// Función para extraer datos de Notion
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
      return field?.start.trim();
    case "multi_select":
      return field?.map((item) => item.name.trim()) ?? [];
    case "status":
    case "select":
      return field?.name.trim();
    case "formula":
      return field?.string?.trim() || field?.number;
    default:
      return undefined;
  }
}

const estudiantesPrueba = async (isTest = false) => {
  if (isTest) {
    console.log("\n📊 MODO TEST - SIMULACIÓN DE DATOS DE NOTION");

  }
  if (!token || !database_id) {
    throw new Error(
      "Faltan variables de entorno necesarias. Por favor, verifica tu archivo .env"
    );
  }

  const myHeaders = new Headers();
  myHeaders.append("Notion-Version", notion_version);
  myHeaders.append("Authorization", `Bearer ${token}`);
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    filter: {
      and: [
        { property: "GeekFORCE Stage", status: { equals: "Stage 1" } },
        { property: "Placement status", status: { equals: "To be placed" } },
        { property: "Educational Status", select: { equals: "Graduated" } },
        {
          property: "Cohort end date",
          rollup: { date: { on_or_after: "2025-04-12" } },
        },
      ],
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
  };

  const response = await fetch(
    `https://api.notion.com/v1/databases/${database_id}/query/`,
    requestOptions
  );
  const data = await response.json();

  if (isTest) {
    // console.log("\n📝 Datos obtenidos de Notion:");
    // console.log(JSON.stringify(data, null, 2));
  }

  const students = data.results
    .map((student) => {
      const daysNumber = extractNotionDataValue(student, "Days in Stage 1");
      const name = extractNotionDataValue(student, "Student");
      const slackId = extractNotionDataValue(student, "Slack ID");
      const coach = student.properties["GeekFORCE Coach"]?.select?.name;
      const currentTags =
        student.properties["GF Follow up"]?.multi_select?.map(
          (tag) => tag.name
        ) || [];

      return {
        id: student.id,
        name,
        slackId,
        daysInStage1: daysNumber,
        coach,
        currentTags,
        withinRange: daysNumber >= 15 && daysNumber <= 30,
        hasMessage1Tag: currentTags.includes("ST1 - Message 1"),
      };
    })
    .filter((student) => student.withinRange && !student.hasMessage1Tag);

  // Enlaces Calendly por coach
  const coachLinks = {
    "Yoaní Palmás": "https://calendly.com/yoanipalmas/30min",
    "Melissa Zwanck": "https://calendly.com/melissazwanck/mentoring",
    "Cristina Crespo": "https://calendly.com/ccrespo-4geeksacademy/30min",
  };

  // Generar mensajes individuales para cada estudiante
  const messages = [];
  let timestamp = new Date("2025-05-21T13:17:30.867Z").getTime();

  for (const student of students) {
    if (!student.coach || !student.slackId) continue;

    const calendlyLink =
      coachLinks[student.coach] || "https://calendly.com/4geeksacademy";
    const message =
      `<@${student.slackId}>\n\n` +
      `He notado que aún no has comenzado el proceso de Career Support.\n\n` +
      `Por favor, reserva tu <${calendlyLink} |🗓️ *primera sesión individual*> de la Etapa 1 en el calendario de tu coach.\n\n` +
      `También te dejo el enlace a la <https://www.notion.so/4geeksacademy/GeekFORCE-Student-Page-260b99bb21ab4555a46740473fe416e0 |📋 *guía GeekFORCE Student Page*> para que te prepares antes de la sesión.\n\n` +
      `Quedo atenta 😊`;

    messages.push({
      message,
      slackId: student.slackId,
      coachIdentifier: student.coach,
      timestamp: new Date(timestamp).toISOString(),
      studentId: student.id,
    });

    // Incrementar el timestamp en 1ms para el siguiente mensaje
    timestamp += 1;
  }

  if (isTest) {
    console.log("\n📊 Resumen de la operación:");
    console.log("- Número de estudiantes procesados:", students.length);
    console.log("- Número de mensajes generados:", messages.length);
  }

  return messages;
};

// Función para obtener estudiantes de Stage 2
const estudiantesStage2 = async (isTest = false) => {
  if (isTest) {
    console.log("\n📊 MODO TEST - SIMULACIÓN DE DATOS DE NOTION (STAGE 2)");
  }

  if (!token || !database_id) {
    throw new Error(
      "Faltan variables de entorno necesarias. Por favor, verifica tu archivo .env"
    );
  }

  const myHeaders = new Headers();
  myHeaders.append("Notion-Version", notion_version);
  myHeaders.append("Authorization", `Bearer ${token}`);
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    filter: {
      and: [
        { property: "GeekFORCE Stage", status: { equals: "Stage 2" } },
        { property: "Placement status", status: { equals: "To be placed" } },
        { property: "Educational Status", select: { equals: "Graduated" } },
      ],
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
  };

  const response = await fetch(
    `https://api.notion.com/v1/databases/${database_id}/query/`,
    requestOptions
  );
  const data = await response.json();

//   if (isTest) {
//     console.log("\n📝 Datos obtenidos de Notion (Stage 2):");
//     console.log(JSON.stringify(data, null, 2));
//   }

  const students = data.results
    .map((student) => {
      const daysNumber = extractNotionDataValue(student, "Days in Stage 2");
      const name = extractNotionDataValue(student, "Student");
      const slackId = extractNotionDataValue(student, "Slack ID");
      const coach = student.properties["GeekFORCE Coach"]?.select?.name;
      const currentTags =
        student.properties["GF Follow up"]?.multi_select?.map(
          (tag) => tag.name
        ) || [];

      return {
        id: student.id,
        name,
        slackId,
        daysInStage2: daysNumber,
        coach,
        currentTags,
        withinRange: daysNumber >= 15 && daysNumber <= 30,
        hasMessage1Tag: currentTags.includes("ST2 - Message 1"),
      };
    })
    .filter((student) => student.withinRange && !student.hasMessage1Tag);

  // Generar mensajes individuales para cada estudiante
  const messages = [];
  let timestamp = new Date("2025-05-21T13:17:30.867Z").getTime();

  for (const student of students) {
    if (!student.coach || !student.slackId) continue;

    const message =
      `<@${student.slackId}>\n\n` +
      `Hola ${student.name}, ¿cómo estás? Te escribo porque he notado que llevas varias semanas en la etapa 2 del proceso de Career Support.\n\n` +
      `¿Hay algo que te impida seguir avanzando? Si tienes algún bloqueo, cuéntame para poder ayudarte.\n\n` +
      `Tienes que completar la preparación para entrevistas lo antes posible para pasar a la etapa 3 (guía y acompañamiento durante la búsqueda de trabajo).\n\n` +
      `Espero tu respuesta para saber en qué punto te encuentras :)`;

    messages.push({
      message,
      slackId: student.slackId,
      coachIdentifier: student.coach,
      timestamp: new Date(timestamp).toISOString(),
      studentId: student.id,
    });

    timestamp += 1;
  }

  if (isTest) {
    console.log("\n📊 Resumen de la operación (Stage 2):");
    console.log("- Número de estudiantes procesados:", students.length);
    console.log("- Número de mensajes generados:", messages.length);
  }

  return messages;
};

// Función principal asíncrona
const main = async (isTest = false, stage = "1") => {
  if (isTest) {
    console.log("🚀 INICIANDO MODO DE PRUEBA COMPLETO");
    console.log("===============================\n");
  }

  try {
    let allMessages = [];
    let stageResults = [];

    // Si es modo test, ejecutar ambos stages
    if (isTest) {
      console.log("\n📊 EJECUTANDO STAGE 1");
      console.log("-------------------");
      const messagesStage1 = await estudiantesPrueba(isTest);
      const successStage1 = await sendToZapierWebhook(messagesStage1, isTest);
      
      if (successStage1) {
        for (const msg of messagesStage1) {
          await updateStudentLastContact(msg.studentId, isTest);
          await updateStudentTags(msg.studentId, "ST1 - Message 1", isTest);
        }
      }

      stageResults.push({
        stage: "1",
        messages: messagesStage1,
        success: successStage1
      });
      allMessages = allMessages.concat(messagesStage1);

      console.log("\n📊 EJECUTANDO STAGE 2");
      console.log("-------------------");
      const messagesStage2 = await estudiantesStage2(isTest);
      const successStage2 = await sendToZapierWebhook(messagesStage2, isTest);
      
      if (successStage2) {
        for (const msg of messagesStage2) {
          await updateStudentLastContact(msg.studentId, isTest);
          await updateStudentTags(msg.studentId, "ST2 - Message 1", isTest);
        }
      }

      stageResults.push({
        stage: "2",
        messages: messagesStage2,
        success: successStage2
      });
      allMessages = allMessages.concat(messagesStage2);

      // Mostrar resumen completo
      console.log("\n📊 RESUMEN COMPLETO DE LA SIMULACIÓN");
      console.log("=================================");
      stageResults.forEach(result => {
        console.log(`\nStage ${result.stage}:`);
        console.log(`- Número de mensajes: ${result.messages.length}`);
        console.log(`- Estado: ${result.success ? "✅ Exitoso" : "❌ Fallido"}`);
        if (result.messages.length > 0) {
          console.log("- Estudiantes a contactar:");
          result.messages.forEach(msg => {
            console.log(`  • ${msg.coachIdentifier} -> ${msg.slackId}`);
          });
        }
      });
      console.log("\n✅ SIMULACIÓN COMPLETADA");

    } else {
      // Modo normal - ejecutar solo el stage especificado
      let messages;
      let tagToAdd;

      if (stage === "1") {
        messages = await estudiantesPrueba(isTest);
        tagToAdd = "ST1 - Message 1";
      } else if (stage === "2") {
        messages = await estudiantesStage2(isTest);
        tagToAdd = "ST2 - Message 1";
      } else {
        throw new Error("Stage no válido. Use '1' o '2'");
      }

      const success = await sendToZapierWebhook(messages, isTest);

      if (success) {
        for (const msg of messages) {
          await updateStudentLastContact(msg.studentId, isTest);
          await updateStudentTags(msg.studentId, tagToAdd, isTest);
        }

        console.log(
          ":marca_de_verificación_blanca: Mensajes enviados exitosamente a Zapier"
        );
      } else {
        console.error(":x: Error al enviar mensajes a Zapier");
      }

      allMessages = messages;
    }

    output = allMessages;
  } catch (error) {
    console.error(
      isTest ? "❌ ERROR EN LA SIMULACIÓN:" : "Error:",
      error.message
    );
  }
};

// Ejecutar la función principal
// Para modo normal: main(false, "1") o main(false, "2")
// Para modo test completo: main(true)
main(true); // Cambiar los parámetros según necesites
