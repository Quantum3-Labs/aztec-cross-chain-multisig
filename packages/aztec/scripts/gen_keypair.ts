import { GrumpkinScalar, Grumpkin } from "@aztec/aztec.js";

async function main() {
  const secret = GrumpkinScalar.random();
  const salt = GrumpkinScalar.random();

  const grumpkin = new Grumpkin();
  const pub = await grumpkin.mul(Grumpkin.generator, secret);

  console.log("SECRET =", secret.toString());
  console.log("SALT   =", salt.toString());
  console.log("PUBKEY =", {
    x: pub.x.toString(),
    y: pub.y.toString(),
  });
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
