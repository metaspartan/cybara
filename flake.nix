{
  description = "Cybara — self-hosted, open-source AI agent platform (CLI)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        release = import ./nix/release.nix;
        slugs = {
          "x86_64-linux" = "linux-x64";
          "aarch64-linux" = "linux-arm64";
          "x86_64-darwin" = "darwin-x64";
          "aarch64-darwin" = "darwin-arm64";
        };
        slug = slugs.${system};
        binary = pkgs.fetchurl {
          url = "https://github.com/metaspartan/cybara/releases/download/v${release.version}/cybara-v${release.version}-${slug}-cli";
          hash = release.hashes.${system};
        };
        cybara = pkgs.stdenv.mkDerivation {
          pname = "cybara";
          version = release.version;
          src = binary;
          dontUnpack = true;
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.stdenv.cc.cc.lib ];
          installPhase = ''
            runHook preInstall
            install -Dm755 $src $out/bin/cybara
            runHook postInstall
          '';
          meta = with pkgs.lib; {
            description = "Self-hosted, open-source AI agent platform (CLI)";
            homepage = "https://cybara.ai";
            license = licenses.mit;
            mainProgram = "cybara";
            platforms = builtins.attrNames slugs;
          };
        };
      in {
        packages.default = cybara;
        packages.cybara = cybara;
        apps.default = flake-utils.lib.mkApp { drv = cybara; name = "cybara"; };
      });
}
