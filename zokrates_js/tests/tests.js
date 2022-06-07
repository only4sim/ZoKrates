const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const dree = require("dree");
const snarkjs = require("snarkjs");
const { initialize } = require("../node/index.js");

let zokratesProvider;
let tmpFolder;

describe("tests", () => {
  // initialize once before running tests
  before(() => {
    return initialize().then((defaultProvider) => {
      zokratesProvider = defaultProvider;
      return fs.promises.mkdtemp( path.join(os.tmpdir(), '' )).then((folder) => {
        tmpFolder = folder;
      });
    });
  });

    describe("compilation", () => {
      it("should compile", () => {
        assert.doesNotThrow(() => {
          const artifacts = zokratesProvider.compile(
            "def main() -> field: return 42"
          );
          assert.ok(artifacts !== undefined);
        });
      });

      it("should compile with snarkjs output", () => {
      assert.doesNotThrow(() => {
        const artifacts = zokratesProvider.compile(
          "def main() -> field: return 42",
          { snarkjs: true }
        );
        assert.ok(artifacts !== undefined);
        assert.ok(artifacts.snarkjsProgram !== undefined);
      });
    });

      it("should throw on invalid code", () => {
        assert.throws(() => zokratesProvider.compile(":-)"));
      });

      it("should resolve stdlib module", () => {
        const stdlib = require("../stdlib.js");
        assert.doesNotThrow(() => {
          const code = `import "${
            Object.keys(stdlib)[0]
          }" as func\ndef main(): return`;
          zokratesProvider.compile(code);
        });
      });

      it("should resolve user module", () => {
        assert.doesNotThrow(() => {
          const code =
            'import "test" as test\ndef main() -> field: return test()';
          const options = {
            resolveCallback: (_, path) => {
              return {
                source: "def main() -> (field): return 1",
                location: path,
              };
            },
          };
          zokratesProvider.compile(code, options);
        });
      });

      it("should throw on unresolved module", () => {
        assert.throws(() => {
          const code =
            'import "test" as test\ndef main() -> field: return test()';
          zokratesProvider.compile(code);
        });
      });
    });

    describe("computation", () => {
      it("should compute with valid inputs", () => {
        assert.doesNotThrow(() => {
          const code = "def main(private field a) -> field: return a * a";
          const artifacts = zokratesProvider.compile(code);
          const result = zokratesProvider.computeWitness(artifacts, ["2"]);
          const output = JSON.parse(result.output);
          assert.deepEqual(output, ["4"]);
        });
      });

      it("should compute with valid inputs with snarkjs output", () => {
      assert.doesNotThrow(() => {
        const code = "def main(private field a) -> field: return a * a";
        const artifacts = zokratesProvider.compile(code);

        const result = zokratesProvider.computeWitness(artifacts, ["2"], {snarkjs: true});

        const output = JSON.parse(result.output);
        assert.deepEqual(output, ["4"]);
        assert.ok(result.snarkjs_witness !== undefined);
      });
    });

      it("should throw on invalid input count", () => {
        assert.throws(() => {
          const code = "def main(private field a) -> field: return a * a";
          const artifacts = zokratesProvider.compile(code);
          zokratesProvider.computeWitness(artifacts, ["1", "2"]);
        });
      });

      it("should throw on invalid input type", () => {
        assert.throws(() => {
          const code = "def main(private field a) -> field: return a * a";
          const artifacts = zokratesProvider.compile(code);
          zokratesProvider.computeWitness(artifacts, [true]);
        });
      });
    });

    const runWithOptions = (options) => {
      let provider;
      let artifacts;
      let computationResult;
      let keypair;
      let proof;

      before(() => {
        provider = zokratesProvider.withOptions(options);
      });

      it("compile", () => {
        assert.doesNotThrow(() => {
          const code =
            "def main(private field a, field b) -> bool: return a * a == b";
          artifacts = provider.compile(code, { snarkjs: true });
        });
      });

      it("compute witness", () => {
        assert.doesNotThrow(() => {
          computationResult = provider.computeWitness(artifacts, ["2", "4"], { snarkjs: true });
        });
      });

      it("setup", () => {
        assert.doesNotThrow(() => {
          if (options.scheme === "marlin") {
            const srs = provider.universalSetup(4);
            keypair = provider.setupWithSrs(srs, artifacts.program);
          } else {
            keypair = provider.setup(artifacts.program);
          }
        });
      });

      if (options.scheme === "g16" && options.curve == "bn128") {
      it("snarkjs setup", () => {
          // write program to fs
          let r1csPath = tmpFolder + "/prog.r1cs";
          let zkeyPath = tmpFolder + "/key.zkey";
          return fs.promises.writeFile(r1csPath, artifacts.snarkjsProgram).then(() => {
            return snarkjs.zKey.newZKey(r1csPath, "./powersOfTau5_0000.ptau", zkeyPath).then(() => {
            });
          })
      })
    }

      if (options.curve === "bn128" && ["g16", "gm17"].includes(options.scheme)) {
        it("export verifier", () => {
          assert.doesNotThrow(() => {
            let verifier = provider.exportSolidityVerifier(keypair.vk);
            assert.ok(verifier.includes("contract"));
          });
        });
      }

      it("generate proof", () => {
        assert.doesNotThrow(() => {
          proof = provider.generateProof(
            artifacts.program,
            computationResult.witness,
            keypair.pk
          );
          assert.ok(proof !== undefined);
          assert.equal(proof.inputs.length, 2);
        });
      });

      if (options.scheme === "g16" && options.curve == "bn128") {
      it("generate snarkjs proof", () => {
          // write witness to fs
          let witnessPath = tmpFolder + "/witness.wtns";
          let zkeyPath = tmpFolder + "/key.zkey";
          return fs.promises.writeFile(witnessPath, [computationResult.snarkjs_witness]).then(() => {
            return snarkjs.groth16.prove(zkeyPath, witnessPath)
          })
      });
    }

      it("verify", () => {
        assert.doesNotThrow(() => {
          assert(provider.verify(keypair.vk, proof) === true);
        });
      });
    };

    for (const scheme of ["g16", "gm17", "marlin"]) {
      describe(scheme, () => {
        for (const curve of ["bn128", "bls12_381", "bls12_377", "bw6_761"]) {
          describe(curve, () => runWithOptions({ scheme, curve }));
        }
      });
    }

  const testRunner = (rootPath, testPath, test) => {
    let entryPoint;
    if (!test.entry_point) {
      entryPoint = testPath.replace(".json", ".zok");
    } else {
      entryPoint = path.join(rootPath, test.entry_point);
    }

    const source = fs.readFileSync(entryPoint).toString();
    const curves = test.curves || ["Bn128"];
    const tests = test.tests || [];
    const withAbi = test.abi !== false;

    const fileSystemResolver = (from, to) => {
      let parsedPath = path.parse(
        path.resolve(path.dirname(path.resolve(from)), to)
      );
      const location = path.format({
        ...parsedPath,
        base: "",
        ext: ".zok",
      });
      const source = fs.readFileSync(location).toString();
      return { source, location };
    };

    for (const curve of curves) {
      it(curve, () => {
        let specializedProvider = zokratesProvider.withOptions({
          curve: curve.toLowerCase(),
          scheme: "g16",
        });

        let options = {
          location: entryPoint,
          resolveCallback: fileSystemResolver,
        };

        if (test.config) {
          options = Object.assign(options, { config: test.config });
        }

        let artifacts = specializedProvider.compile(source, options);
        for (const t of tests) {
          const withAbiOverride = typeof t.abi === "boolean" ? t.abi : withAbi;
          const input = withAbiOverride ? artifacts : artifacts.program;

          try {
            const result = specializedProvider.computeWitness(
              input,
              t.input.values
            );
            const values = JSON.parse(result.output);
            assert.deepEqual({ Ok: { values } }, t.output);
          } catch (err) {
            assert.ok(t.output["Err"], err); // we expected an error in this test
          }
        }
      }).timeout(300000);
    }
  };

  describe("core tests", () => {
    const rootPath = path.resolve("../zokrates_core_test");
    const testsPath = path.join(rootPath, "/tests/tests");

    const ignoreList = ["snark/"];
    const options = {
      extensions: ["json"],
    };

    dree.scan(testsPath, options, function (file) {
      const test = require(file.path);
      const testName = file.path.substring(testsPath.length + 1);

      if (!ignoreList.some(v => testName.startsWith(v)))
        describe(testName, () => testRunner(rootPath, file.path, test));
    });
  });
})