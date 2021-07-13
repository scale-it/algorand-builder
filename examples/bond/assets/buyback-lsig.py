from pyteal import *

def buyback_lsig():
    # check no rekeying, close remainder to, asset close to
    common_fields = And(
        Gtxn[0].rekey_to() == Global.zero_address(),
        Gtxn[1].rekey_to() == Global.zero_address(),
        Gtxn[2].rekey_to() == Global.zero_address(),
        Gtxn[0].close_remainder_to() == Global.zero_address(),
        Gtxn[1].close_remainder_to() == Global.zero_address(),
        Gtxn[2].close_remainder_to() == Global.zero_address(),
        Gtxn[1].asset_close_to() == Global.zero_address(),
    )

    # verify that buyer deposits required algos 
    verify_tx = And(
        Gtxn[0].type_enum() == TxnType.AssetTransfer,
        Gtxn[0].xfer_asset() == Tmpl.Int("TMPL_BOND"),
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[2].application_id() == Tmpl.Int("TMPL_APPLICATION_ID"),
        Gtxn[2].application_args[0] == Bytes("exit"),
        common_fields
    )

    # allow opt-in transaction
    opt_in = And(
        Gtxn[0].type_enum() == TxnType.Payment,
        Gtxn[0].amount() == Int(0),
        Gtxn[0].sender() == Tmpl.Addr("TMPL_STORE_MANAGER"),
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_amount() == Int(0)
    )

    program = Cond(
        [Global.group_size() == Int(3), verify_tx],
        [Global.group_size() == Int(2), opt_in],
    )

    return program

if __name__ == "__main__":
    print(compileTeal(buyback_lsig(), Mode.Signature))