# Makefile
.PHONY: all arbitrum aztec-compile docker clean stop

all: arbitrum aztec-compile docker

arbitrum:
	@echo "Building Arbitrum contracts..."
	@cd packages/arbitrum && make all

aztec-compile:
	@echo "Compiling Aztec contracts..."
	@cd packages/aztec && yarn clean && yarn clear-store && yarn compile && yarn codegen

docker:
	@echo "Running Docker containers..."
	@docker-compose up --build

stop:
	@echo "Stopping Docker..."
	@docker-compose down

clean: stop
	@echo "Cleaning up..."
	@rm -f sandbox.log
	@cd packages/aztec && yarn clean
	@cd packages/arbitrum && make clean