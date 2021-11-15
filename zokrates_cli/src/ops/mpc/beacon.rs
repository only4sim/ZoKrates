use crate::constants::MPC_DEFAULT_PATH;
use clap::{App, Arg, ArgMatches, SubCommand};
use phase2::parameters::MPCParameters;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

pub fn subcommand() -> App<'static, 'static> {
    SubCommand::with_name("beacon")
        .about("Applies a random beacon")
        .arg(
            Arg::with_name("input")
                .short("i")
                .long("input")
                .help("Path of the MPC parameters")
                .value_name("FILE")
                .takes_value(true)
                .required(false)
                .default_value(MPC_DEFAULT_PATH),
        )
        .arg(
            Arg::with_name("hash")
                .short("h")
                .long("hash")
                .help("Hash used for the beacon")
                .takes_value(true)
                .required(true),
        )
        .arg(
            Arg::with_name("iterations")
                .short("n")
                .long("iterations")
                .help("Number of hash iterations")
                .takes_value(true)
                .required(true),
        )
        .arg(
            Arg::with_name("output")
                .short("o")
                .long("output")
                .help("Path of the output file")
                .value_name("FILE")
                .takes_value(true)
                .required(false)
                .default_value(MPC_DEFAULT_PATH),
        )
}

pub fn exec(sub_matches: &ArgMatches) -> Result<(), String> {
    let path = Path::new(sub_matches.value_of("input").unwrap());
    let file =
        File::open(&path).map_err(|why| format!("Could not open `{}`: {}", path.display(), why))?;

    let reader = BufReader::new(file);
    let mut params = MPCParameters::read(reader, true)
        .map_err(|why| format!("Could not read `{}`: {}", path.display(), why))?;

    let beacon_hash = sub_matches.value_of("hash").unwrap();
    let num_iterations: usize = sub_matches.value_of("iterations").unwrap().parse().unwrap();

    if !(10..=63).contains(&num_iterations) {
        return Err("Number of hash iterations should be in the [10, 63] range".to_string());
    }

    println!("Creating a beacon RNG");

    // Create an RNG based on the outcome of the random beacon
    let mut rng = {
        use byteorder::{BigEndian, ReadBytesExt};
        use crypto::digest::Digest;
        use crypto::sha2::Sha256;
        use rand::chacha::ChaChaRng;
        use rand::SeedableRng;

        // The hash used for the beacon
        let mut cur_hash = hex::decode(beacon_hash)
            .map_err(|_| "Beacon hash should be in hexadecimal format".to_string())?;

        if cur_hash.len() != 32 {
            return Err("Beacon hash should be 32 bytes long".to_string());
        }

        // Performs 2^n hash iterations over it
        let n: usize = num_iterations;

        for i in 0..(1u64 << n) {
            // Print 1024 of the interstitial states
            // so that verification can be
            // parallelized
            if i % (1u64 << (n - 10)) == 0 {
                print!("{}: ", i);
                for b in cur_hash.iter() {
                    print!("{:02x}", b);
                }
                println!();
            }

            let mut h = Sha256::new();
            h.input(&cur_hash);
            h.result(&mut cur_hash);
        }

        print!("Final result of beacon: ");
        for b in cur_hash.iter() {
            print!("{:02x}", b);
        }
        println!("\n");

        let mut digest = &cur_hash[..];

        let mut seed = [0u32; 8];
        for e in &mut seed {
            *e = digest.read_u32::<BigEndian>().unwrap();
        }

        ChaChaRng::from_seed(&seed)
    };

    println!("Contributing to `{}`...", path.display());
    let zero: u32 = 0;
    let hash = params.contribute(&mut rng, &zero);

    println!("The BLAKE2b hash of your contribution is:\n");
    for line in hash.chunks(16) {
        print!("\t");
        for section in line.chunks(4) {
            for b in section {
                print!("{:02x}", b);
            }
            print!(" ");
        }
        println!();
    }

    let output_path = Path::new(sub_matches.value_of("output").unwrap());
    let output_file = File::create(&output_path)
        .map_err(|why| format!("Could not create `{}`: {}", output_path.display(), why))?;

    println!(
        "\nYour contribution has been written to `{}`",
        output_path.display()
    );

    let mut writer = BufWriter::new(output_file);
    params.write(&mut writer).map_err(|e| e.to_string())?;

    Ok(())
}
