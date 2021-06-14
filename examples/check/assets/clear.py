from pyteal import *

def clear_state_program():
    return Return(Int(1))

if __name__ == "__main__":
    print(compileTeal(clear_state_program(), Mode.Application, version=3))