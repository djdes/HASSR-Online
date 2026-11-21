// Демо-база для снимков: проводит проверки по назначениям чек-листов
// (ответы «Да», числа — середина диапазона) через логику самого приложения.
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { allChecklistQuestions, checklistDefinitionSchema, type ChecklistAnswers } from "../../../../src/lib/custom-checklists";
import { evaluateChecklistRun } from "../../../../src/lib/custom-checklist-runtime";

const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });
// Белый пиксель PNG — «подпись» демо-проверки.
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const ids = process.argv.slice(2);
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "admin@haccp.local" } });
  for (const [index, assignmentId] of ids.entries()) {
    const assignment = await prisma.checklistAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { template: true } });
    const definition = checklistDefinitionSchema.parse(assignment.template.definition);
    const completedAt = new Date(Date.now() - (index + 1) * 40 * 60 * 1000);
    const stamp = completedAt.toISOString().slice(0, 16);
    const answers: ChecklistAnswers = {};
    for (const question of allChecklistQuestions(definition)) {
      switch (question.type) {
        case "yes_no": answers[question.id] = "yes"; break;
        case "checkbox": answers[question.id] = true; break;
        case "number": case "scale": answers[question.id] = question.max; break;
        case "choice": if (question.options[0]) answers[question.id] = question.options[0].value; break;
        case "multi": if (question.options[0]) answers[question.id] = [question.options[0].value]; break;
        case "datetime": answers[question.id] = stamp; break;
        case "text": answers[question.id] = "Без замечаний"; break;
        case "signature": answers[question.id] = SIGNATURE; break;
        default: break;
      }
    }
    const result = evaluateChecklistRun(definition, answers);
    const inspection = await prisma.checklistInspection.create({
      data: {
        organizationId: assignment.organizationId,
        templateId: assignment.templateId,
        templateVersion: assignment.template.version,
        title: assignment.template.title,
        snapshot: assignment.template.definition as Prisma.InputJsonValue,
        answers: answers as Prisma.InputJsonValue,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        createdById: owner.id,
        createdByName: owner.name ?? "",
        assignmentId,
        status: "completed",
        completedAt,
        completedById: owner.id,
        completedByName: owner.name ?? "",
      },
      select: { id: true },
    });
    console.log(assignmentId, "→", inspection.id, `score ${result.score.earned}/${result.score.possible}`);
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
