{
  description = "Hive — distributed orchestrator: prime-agent queen + cursor-agent workers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    agentic.url = "github:codegod100/agentic";
    nix-ai-tools.url = "github:numtide/nix-ai-tools";
  };

  outputs =
    {
      self,
      nixpkgs,
      agentic,
      nix-ai-tools,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          pkgsUnfree = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          hive = pkgs.python3Packages.buildPythonApplication {
            pname = "hive";
            version = "0.1.0";
            pyproject = true;
            src = ./.;
            nativeBuildInputs = [ pkgs.uv ];
            propagatedBuildInputs = with pkgs.python3Packages; [
              fastapi
              uvicorn
              pydantic
              pydantic-settings
              httpx
              websockets
            ];
            doCheck = false;
          };
        in
        {
          default = hive;
          inherit hive;
          prime-agent = agentic.packages.${system}.prime-agent;
          cursor-agent = pkgsUnfree.nix-ai-tools.packages.${system}.cursor-agent;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          hive = self.packages.${system}.hive;
          prime-agent = self.packages.${system}.prime-agent;
          cursor-agent = self.packages.${system}.cursor-agent;
        in
        {
          default = {
            type = "app";
            program = "${pkgs.writeShellScript "hive" ''
              export PATH="${nixpkgs.lib.makeBinPath [ prime-agent cursor-agent ]}:$PATH"
              exec ${hive}/bin/hive "$@"
            ''}";
          };
          hive = self.apps.${system}.default;
          prime-agent = agentic.apps.${system}.prime-agent;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          pkgsUnfree = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              python312
              uv
              nodejs_22
              self.packages.${system}.prime-agent
              pkgsUnfree.nix-ai-tools.packages.${system}.cursor-agent
            ];
            shellHook = ''
              echo "Hive dev shell — prime-agent + cursor-agent on PATH"
              echo "  uv sync && uv run hive"
            '';
          };
        }
      );
    };
}
