!include "c64.asm"
!use "./text" as text

+c64::basic_start(entry)

* = $1000 ; Relocate code to $1000

entry:
    ; clear screen
    ldx #0
    lda #32
clear_loop:
    sta $0400,x
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne clear_loop

    ldx #0
print_loop:
    lda c64text,x
    beq done
    sta $0400,x
    inx
    jmp print_loop

done:
    jmp done

c64text:
!byte text("Hello C64jasm!"), 0
