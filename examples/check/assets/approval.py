from pyteal import *

def approval_program():

    on_deployment = Seq([
        App.globalPut(Bytes("mynumber"), Txn.application_args[0]),
        Return(Int(1))
    ])

    on_call = Seq([
        Assert(
            Int(50) == Btoi(App.globalGet(Bytes("mynumber")))
        ),
        Return(Int(1))
    ])

    program = Cond(
        [Txn.application_id() == Int(0), on_deployment],
        [Txn.on_completion() == OnComplete.NoOp, on_call],
    )

    return program

if __name__ == "__main__":

    print(compileTeal(approval_program(), Mode.Application, version = 3))
