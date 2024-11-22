import { ComAtprotoLabelDefs } from "@atcute/client/lexicons";
import {
  getLabelerLabelDefinitions,
  setLabelerLabelDefinitions,
} from "@skyware/labeler/scripts";
import { DID, PORT, MAXLABELS, SIGNING_KEY, LABELER_PASSWORD, DB_PATH } from "./constants.js";
import { LabelerServer } from "@skyware/labeler";

const server = new LabelerServer({
  did: DID,
  signingKey: SIGNING_KEY,
  dbPath: DB_PATH,
});

server.app.listen({ port: PORT, host: "::" }, (error, address) => {
  if (error) console.error(error);
  else console.log(`Labeler server listening on ${address}`);
});

const credentials = {
  identifier: DID,
  password: LABELER_PASSWORD,
};

interface Label {
  name: string;
  description: string;
}

function getIdentifier(name: string) {
  // TODO this is where future Jakob is gonna be sad
  // 2NE1 becomes "two-ne-one"
  // ref: https://github.com/hipstersmoothie/github-labeler-bot/blob/c08d551e9f10a03908619c73b9f0c51a4e5bd982/src/label-server.ts#L43
  return name.replace("/", "-");
}

async function createLabel({ name, description }: Label) {
  const identifier = getIdentifier(name);
  const currentLabels = (await getLabelerLabelDefinitions(credentials)) || [];

  if (currentLabels.find((label) => label.identifier === identifier)) {
    console.log(`Label ${identifier} already exists`);
    return;
  }

  await setLabelerLabelDefinitions(credentials, [
    ...currentLabels,
    {
      identifier,
      severity: "inform",
      blurs: "none",
      defaultSetting: "warn",
      adultOnly: false,
      locales: [{ lang: "en", description, name }],
    },
  ]);
  console.log(`Created label ${identifier}!`);
}

export const addUserLabel = async (did: string, label: Label) => {
  const identifier = getIdentifier(label.name);
  // Get the current labels for the did
  const query = server.db
    .prepare<string[]>(`SELECT * FROM labels WHERE uri = ?`)
    .all(did) as ComAtprotoLabelDefs.Label[];

  await createLabel(label);

  // make a set of the current labels
  const labels = query.reduce((set, label) => {
    if (!label.neg) set.add(label.val);
    else set.delete(label.val);
    return set;
  }, new Set<string>());

  try {
    if (labels.size < MAXLABELS) {
      server.createLabel({ uri: did, val: identifier });
      console.log(`${new Date().toISOString()} Labeled ${did}: ${identifier}`);
      return true;
    }
  } catch (err) {
    console.error(err);
  }

  return false;
};

export const clearUserLabels = async (did: string) => {
  // Get the current labels for the did
  const query = server.db
    .prepare<string[]>(`SELECT * FROM labels WHERE uri = ?`)
    .all(did) as ComAtprotoLabelDefs.Label[];

  // make a set of the current labels
  const labels = query.reduce((set, label) => {
    if (!label.neg) set.add(label.val);
    else set.delete(label.val);
    return set;
  }, new Set<string>());

  try {
    server.createLabels({ uri: did }, { negate: [...labels] });
    console.log(`${new Date().toISOString()} Deleted labels: ${did}`);
  } catch (err) {
    console.error(err);
  }
};

interface Session {
  accessJwt: string;
  refreshJwt: string;
}

export const getStoredSession = () => {
  // initialize session table if it doesn't exist
  server.db
    .prepare(
      `CREATE TABLE IF NOT EXISTS session (uri TEXT PRIMARY KEY, accessJwt TEXT, refreshJwt TEXT)`
    )
    .run();

  // TODO: https://github.com/skyware-js/bot/issues/16
  return null as Session | null;
  // return server.db
  //   .prepare<string[]>(`SELECT * FROM session WHERE uri = ?`)
  //   .get(DID) as unknown as Session | null;
};

export const setStoredSession = (session: Session) => {
  server.db
    .prepare(
      `INSERT OR REPLACE INTO session (uri, accessJwt, refreshJwt) VALUES (?, ?, ?)`
    )
    .run(DID, session.accessJwt, session.refreshJwt);
};
