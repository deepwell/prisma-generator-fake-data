import { logger } from '@prisma/internals';
import { DMMF } from '@prisma/generator-helper';

function getFieldDefinition(
  models: DMMF.Model[],
  model: DMMF.Model,
  field: DMMF.Field,
  enums: DMMF.DatamodelEnum[],
) {
  let nullHandling = '';
  if (!field.isRequired) {
    nullHandling = `faker.datatype.boolean() ? undefined : `;
  }
  if (field.kind === 'enum') {
    const enumName = field.type;
    const enumValues = enums.find((it) => it.name === enumName)?.values || [];
    if (enumValues.length === 0) {
      logger.warn(
        `Enum ${enumName} has no enum values. Field ${field.name} won't be generated.`,
      );
    } else {
      const enumValuesAsString = enumValues
        .map((v) => `'${v.name}'`)
        .join(', ');
      return `${field.name}: ${nullHandling}faker.helpers.arrayElement([${enumValuesAsString}] as const)`;
    }
  }
  if (field.isId) {
    return `${field.name}: ${nullHandling}${
      field.type === 'String'
        ? 'faker.datatype.uuid()'
        : 'faker.datatype.number()'
    }`;
  }
  if (model.fields.some((it) => it.relationFromFields?.includes(field.name))) {
    return `${field.name}: ${nullHandling}${
      field.type === 'String'
        ? 'faker.datatype.uuid()'
        : 'faker.datatype.number()'
    }`;
  }
  if (field.type === 'String') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}faker.lorem.words(5).split(' ')`;
    }
    if (field.name === 'email') {
      return `${field.name}: ${nullHandling}faker.internet.email()`;
    }
    if (field.name === 'name') {
      return `${field.name}: ${nullHandling}faker.name.fullName()`;
    }
    if (field.name === 'firstName') {
      return `${field.name}: ${nullHandling}faker.name.firstName()`;
    }
    if (field.name === 'lastName') {
      return `${field.name}: ${nullHandling}faker.name.lastName()`;
    }
    return `${field.name}: ${nullHandling}faker.lorem.words(5)`;
  }
  if (field.type === 'Int' || field.type === 'BigInt') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}[faker.datatype.number(),faker.datatype.number(),faker.datatype.number(),faker.datatype.number(),faker.datatype.number()]`;
    }
    if (field.name === 'age') {
      return `${field.name}: ${nullHandling}faker.datatype.number({min: 0, max: 99})`;
    }
    return `${field.name}: ${nullHandling}faker.datatype.number()`;
  }
  if (field.type === 'Float') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}[faker.datatype.float(),faker.datatype.float(),faker.datatype.float(),faker.datatype.float(),faker.datatype.float()]`;
    }
    return `${field.name}: ${nullHandling}faker.datatype.float()`;
  }
  if (field.type === 'Boolean') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}[faker.datatype.boolean(),faker.datatype.boolean(),faker.datatype.boolean(),faker.datatype.boolean(),faker.datatype.boolean()]`;
    }
    return `${field.name}: ${nullHandling}faker.datatype.boolean()`;
  }
  if (field.type === 'Decimal') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}[faker.datatype.hexaDecimal(),faker.datatype.hexaDecimal(),faker.datatype.hexaDecimal(),faker.datatype.hexaDecimal(),faker.datatype.hexaDecimal()]`;
    }
    return `${field.name}: ${nullHandling}faker.datatype.hexaDecimal()`;
  }
  if (field.type === 'DateTime') {
    if (field.isList) {
      return `${field.name}: ${nullHandling}[faker.datatype.datetime(),faker.datatype.datetime(),faker.datatype.datetime(),faker.datatype.datetime(),faker.datatype.datetime()]`;
    }
    return `${field.name}: ${nullHandling}faker.datatype.datetime()`;
  }
  if (field.type === 'Json') {
    const docLines = field.documentation?.split('\n') || [];
    const fake = docLines.find((line) => line.startsWith('FAKE:'));
    if (fake) {
      const fakeValue = fake.replace('FAKE:', '');
      if (!fakeValue) {
        logger.warn(
          `Incorrect format for fake JSON. Field ${field.name} won't be generated. Example: ///[FAKE:{"test": "faker.lorem.word()"}]`,
        );
        return null;
      }
      return `${field.name}: ${nullHandling}${fakeValue}`;
    }
    return `${field.name}: ${nullHandling}JSON.parse(faker.datatype.json())`;
  }
  logger.warn(
    `Type ${field.type}${field.isList ? '[]' : ''} (${
      field.kind
    }) is not supported. Field ${field.name} won't be generated.`,
  );
  return null;
}

export async function createMethods(
  { enums, models }: DMMF.Datamodel,
  extraImport?: string,
  extraExport?: string,
) {
  const functions: string[] = [];

  models.forEach((m) => {
    createFakeFunctionsWithoutFKs(models, m, enums, functions);
    createFakeFunctionsWithFKs(models, m, enums, functions);
  });
  return await `import type { Prisma } from '@prisma/client';
import { faker } from '@faker-js/faker';
${extraImport || ''}
${extraExport || ''}

${functions.join('\n')}
`;
}
function createFakeFunctionsWithoutFKs(
  models: DMMF.Model[],
  model: DMMF.Model,
  enums: DMMF.DatamodelEnum[],
  functions: string[],
) {
  const validFields = model.fields
    .filter((field) => !field.isId)
    .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
    .filter((field) => {
      return !model.fields.find((it) => {
        return it.relationFromFields?.includes(field.name);
      });
    })
    .filter((field) => !field.hasDefaultValue)
    .map((f) => getFieldDefinition(models, model, f, enums))
    .filter(Boolean);
  if (validFields.length > 0) {
    functions.push(
      `export function fake${model.name}() {
  return {
    ${validFields.join(',\n    ')},
  };
}`,
    );
  }
}

function createFakeFunctionsWithFKs(
  models: DMMF.Model[],
  model: DMMF.Model,
  enums: DMMF.DatamodelEnum[],
  functions: string[],
) {
  const validFields = model.fields
    .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
    .map((f) => getFieldDefinition(models, model, f, enums))
    .filter(Boolean);
  if (validFields.length > 0) {
    functions.push(
      `export function fake${model.name}Complete() {
  return {
    ${validFields.join(',\n    ')},
  };
}`,
    );
  }
}
